// Typed client for the Rudisha contract. Every write stores its evidence
// document first, then puts only the document's hash on-chain.
import { teraToGas } from "near-api-js";
import { assessWithNearAi } from "../assessor/nearai.js";
import { assessWithRules } from "../assessor/rules.js";
import { assessorUsesNearAi } from "./config.js";
import {
  AssessmentDoc,
  ChainRecord,
  ClaimDoc,
  ContractConfig,
  DisputeDoc,
  Lease,
  Report,
  RulingDoc,
  claimTotal,
} from "./domain.js";
import { Key, ONE_NEAR, account, call, view } from "./near.js";
import { DeployState } from "./state.js";
import { mustGet, put } from "./store.js";

export type LeaseTerms = {
  tenant: string;
  deposit: string;
  label: string;
  lease_ends_in_secs: number;
  claim_window_secs: number;
  response_window_secs: number;
  appeal_window_secs: number;
};

export class Rudisha {
  constructor(readonly s: DeployState) {}

  private get c() {
    return this.s.contractId;
  }

  // ---------------- reads

  config = () => view<ContractConfig>(this.c, "get_config");
  lease = (id: number) => view<Lease | null>(this.c, "get_lease", { lease_id: id });
  leasesOf = (accountId: string) => view<Lease[]>(this.c, "leases_of", { account_id: accountId });
  record = (accountId: string) => view<ChainRecord>(this.c, "get_record", { account_id: accountId });
  claimable = (accountId: string) => view<string>(this.c, "get_claimable", { account_id: accountId });
  tokenBalance = (accountId: string) => view<string>(this.s.tokenId, "ft_balance_of", { account_id: accountId });

  async allLeases(): Promise<Lease[]> {
    const out: Lease[] = [];
    for (let from = 0; ; from += 100) {
      const page = await view<Lease[]>(this.c, "list_leases", { from_id: from, limit: 100 });
      out.push(...page);
      if (page.length < 100) return out;
    }
  }

  async mustLease(id: number): Promise<Lease> {
    const l = await this.lease(id);
    if (!l) throw new NotFound(`lease ${id} does not exist`);
    return l;
  }

  // ---------------- writes (each takes the signer's key)

  async createLease(landlord: Key, t: LeaseTerms): Promise<number> {
    return call<number>(account(landlord), this.c, "create_lease", { ...t }, { deposit: ONE_NEAR / 20n });
  }

  /** Tenant pays the deposit with ft_transfer_call; a mismatch is refunded by the token. */
  async fund(tenant: Key, leaseId: number): Promise<void> {
    const l = await this.mustLease(leaseId);
    await account(tenant).callFunction({
      contractId: this.s.tokenId,
      methodName: "ft_transfer_call",
      args: { receiver_id: this.c, amount: l.deposit, msg: JSON.stringify({ lease_id: leaseId }) },
      gas: teraToGas("100"),
      deposit: 1n,
    });
    const after = await this.mustLease(leaseId);
    if (after.state !== "Funded") {
      throw new Conflict(`the deposit was not accepted and has been refunded (lease ${leaseId} is ${after.state}; only the named tenant can pay the exact deposit)`);
    }
  }

  async signCheckin(who: Key, leaseId: number, report: Report): Promise<string> {
    const h = put(report);
    await call(account(who), this.c, "sign_checkin", { lease_id: leaseId, checkin_hash: h });
    return h;
  }

  async submitCheckout(who: Key, leaseId: number, report: Report): Promise<string> {
    const h = put(report);
    await call(account(who), this.c, "submit_checkout", { lease_id: leaseId, checkout_hash: h });
    return h;
  }

  returnInFull = (landlord: Key, leaseId: number) => call(account(landlord), this.c, "return_in_full", { lease_id: leaseId });

  async fileClaim(landlord: Key, leaseId: number, claim: ClaimDoc): Promise<string> {
    const h = put(claim);
    await call(account(landlord), this.c, "file_claim", {
      lease_id: leaseId,
      amount: claimTotal(claim).toString(),
      items_hash: h,
    });
    return h;
  }

  acceptClaim = (tenant: Key, leaseId: number) => call(account(tenant), this.c, "accept_claim", { lease_id: leaseId });

  async dispute(tenant: Key, leaseId: number, doc: DisputeDoc): Promise<string> {
    const h = put(doc);
    await call(account(tenant), this.c, "dispute", { lease_id: leaseId, reason_hash: h });
    return h;
  }

  async appeal(who: Key, leaseId: number, doc: DisputeDoc): Promise<string> {
    const h = put(doc);
    await call(account(who), this.c, "appeal", { lease_id: leaseId, reason_hash: h });
    return h;
  }

  async rule(arbiter: Key, leaseId: number, doc: RulingDoc): Promise<string> {
    const h = put(doc);
    await call(account(arbiter), this.c, "rule", { lease_id: leaseId, to_landlord: doc.to_landlord, reason_hash: h });
    return h;
  }

  cancel = (who: Key, leaseId: number) => call(account(who), this.c, "cancel", { lease_id: leaseId });
  finalize = (who: Key, leaseId: number) => call(account(who), this.c, "finalize", { lease_id: leaseId });
  withdraw = (who: Key) => call(account(who), this.c, "withdraw", {}, { tgas: 60 });

  /**
   * Runs the assessor on a disputed lease and submits the verdict.
   * NEAR AI (in a TEE) when a key is configured, otherwise the rule engine.
   */
  async assess(leaseId: number): Promise<{ doc: AssessmentDoc; reasonHash: string; attestationHash: string; checks: unknown[] }> {
    const l = await this.mustLease(leaseId);
    if (l.state !== "Disputed") throw new Conflict(`lease ${leaseId} is ${l.state}, not Disputed`);
    const checkin = mustGet<Report>(l.checkin_hash, "move-in report");
    const checkout = mustGet<Report>(l.checkout_hash, "move-out report");
    const claim = mustGet<ClaimDoc>(l.claim?.items_hash, "claim");
    const dispute = l.dispute_reason_hash ? mustGet<DisputeDoc>(l.dispute_reason_hash, "dispute") : null;

    let doc: AssessmentDoc;
    let attestationHash: string;
    let checks: unknown[] = [];
    if (assessorUsesNearAi()) {
      const r = await assessWithNearAi(checkin, checkout, claim, dispute);
      doc = r.doc;
      checks = r.checks;
      attestationHash = put({ kind: "nearai-proof", proof: r.proof, checks: r.checks });
    } else {
      doc = assessWithRules(checkin, checkout, claim);
      // No TEE: the "attestation" is an honest marker that the open rule engine ran.
      attestationHash = put({ kind: "rules-engine", engine: "rules-v1", note: "No TEE. Deterministic rules in src/assessor/rules.ts." });
    }
    const reasonHash = put(doc);
    await call(account(this.s.assessor), this.c, "submit_assessment", {
      lease_id: leaseId,
      to_landlord: doc.to_landlord,
      reason_hash: reasonHash,
      attestation_hash: attestationHash,
      confidence_bps: doc.confidence_bps,
    });
    return { doc, reasonHash, attestationHash, checks };
  }
}

export class NotFound extends Error {}
export class Conflict extends Error {}

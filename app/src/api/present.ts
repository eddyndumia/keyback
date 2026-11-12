// Turns raw on-chain leases into what a UI needs: who can do what right now,
// a human timeline, ISO times, and resolved evidence documents.
import type { Lease, LeaseState } from "../lib/domain.js";
import { get } from "../lib/store.js";
import { usd } from "../lib/near.js";

export type Role = "landlord" | "tenant" | "assessor" | "arbiter" | "anyone";
export type Action = {
  action: string;
  role: Role;
  label: string;
  /** If set, the action becomes possible only after this time. */
  after?: string;
  /** If set, the action stops being possible at this time. */
  before?: string;
};

const NS = 1_000_000n;
export const iso = (ns: string | number): string | null => {
  const v = BigInt(ns);
  return v === 0n ? null : new Date(Number(v / NS)).toISOString();
};

const PHASE: Record<LeaseState, string> = {
  Created: "Waiting for the tenant's deposit",
  Funded: "Waiting for both move-in signatures",
  Active: "Tenancy in progress",
  MoveOut: "Moved out: landlord's claim window is open",
  Claimed: "Claim filed: waiting for the tenant",
  Disputed: "Disputed: with the assessor",
  Assessed: "Assessed: appeal window is open",
  Appealed: "Appealed: with the human arbiter",
  Settled: "Settled",
  Cancelled: "Cancelled",
};

export function actionsFor(l: Lease, nowMs = Date.now()): Action[] {
  const deadline = BigInt(l.deadline) / NS;
  const open = deadline > 0n && BigInt(nowMs) <= deadline;
  const passed = deadline > 0n && BigInt(nowMs) > deadline;
  const dl = iso(l.deadline) ?? undefined;
  const out: Action[] = [];
  const add = (action: string, role: Role, label: string, extra: Partial<Action> = {}) =>
    out.push({ action, role, label, ...extra });

  switch (l.state) {
    case "Created":
      add("fund", "tenant", "Pay the deposit");
      add("cancel", "landlord", "Cancel the lease");
      add("cancel", "tenant", "Cancel the lease");
      break;
    case "Funded":
      if (!l.checkin_by_landlord) add("sign_checkin", "landlord", "Sign the move-in report");
      if (!l.checkin_by_tenant) add("sign_checkin", "tenant", "Sign the move-in report");
      add("cancel", "landlord", "Cancel and refund the tenant");
      add("cancel", "tenant", "Cancel and get the deposit back");
      break;
    case "Active": {
      const end = iso(l.lease_end) ?? undefined;
      add("submit_checkout", "landlord", "Record the move-out report", { after: end });
      add("submit_checkout", "tenant", "Record the move-out report", { after: end });
      break;
    }
    case "MoveOut":
      counterAction(l, add);
      if (open) {
        add("return_in_full", "landlord", "Return the deposit in full");
        add("file_claim", "landlord", "Claim deductions", { before: dl });
      }
      if (passed) add("finalize", "anyone", "No claim was filed: release the full deposit to the tenant");
      break;
    case "Claimed":
      counterAction(l, add);
      if (open) {
        add("accept_claim", "tenant", "Accept the claim");
        add("dispute", "tenant", "Dispute the claim", { before: dl });
      }
      if (passed) add("finalize", "anyone", "No response: the claim stands");
      break;
    case "Disputed":
      counterAction(l, add);
      if (open) add("assess", "assessor", "Assess the dispute", { before: dl });
      if (passed) {
        add("appeal", "landlord", "Assessor missed its deadline: go to the arbiter");
        add("appeal", "tenant", "Assessor missed its deadline: go to the arbiter");
      }
      break;
    case "Assessed":
      if (open) {
        add("appeal", "landlord", "Appeal to the human arbiter", { before: dl });
        add("appeal", "tenant", "Appeal to the human arbiter", { before: dl });
      }
      if (passed) add("finalize", "anyone", "No appeal: apply the assessment");
      break;
    case "Appealed":
      add("rule", "arbiter", "Make the final ruling");
      break;
  }
  return out;
}

function counterAction(l: Lease, add: (a: string, r: Role, label: string) => void) {
  if (l.counter_checkout_hash) return;
  const other: Role = l.checkout_by === l.landlord ? "tenant" : "landlord";
  add("counter_checkout", other, "Add your own move-out report (if you disagree)");
}

export type TimelineEntry = { at: string; event: string; detail?: string };

export function timeline(l: Lease): TimelineEntry[] {
  const t: TimelineEntry[] = [];
  const push = (ns: string | undefined | null, event: string, detail?: string) => {
    const at = ns ? iso(ns) : null;
    if (at) t.push({ at, event, detail });
  };
  push(l.created_at, "Lease created", `Deposit of ${usd(l.deposit)}`);
  push(l.funded_at, "Tenant paid the deposit into the contract");
  push(l.active_at, "Both signed the move-in report");
  push(l.moveout_at, "Move-out report recorded");
  push(l.claim?.filed_at, "Landlord filed a claim", l.claim ? `Wants to keep ${usd(l.claim.amount)}` : undefined);
  push(l.assessment?.at, "Assessor decided", l.assessment ? `${usd(l.assessment.to_landlord)} to the landlord` : undefined);
  push(l.appeal?.at, "Sent to the human arbiter", l.appeal ? `Asked by ${l.appeal.by}` : undefined);
  push(l.ruling?.at, "Arbiter made the final call", l.ruling ? `${usd(l.ruling.to_landlord)} to the landlord` : undefined);
  push(l.settled_at, l.state === "Cancelled" ? "Cancelled" : "Money paid out", l.state === "Cancelled" ? undefined : `${usd(l.paid_to_tenant)} to the tenant, ${usd(l.paid_to_landlord)} to the landlord`);
  return t.sort((a, b) => a.at.localeCompare(b.at));
}

const doc = (h: string | null | undefined) => {
  if (!h) return null;
  try {
    return get(h);
  } catch {
    return { error: "document failed its hash check" };
  }
};

/** Lease summary for lists. */
export function present(l: Lease, nowMs = Date.now()) {
  return {
    ...l,
    phase: PHASE[l.state],
    deadline_iso: iso(l.deadline),
    lease_end_iso: iso(l.lease_end),
    held: (BigInt(l.deposit) - BigInt(l.paid_to_tenant) - BigInt(l.paid_to_landlord)).toString(),
    actions: actionsFor(l, nowMs),
  };
}

/** Full lease with timeline and every evidence document resolved. */
export function presentDetail(l: Lease, nowMs = Date.now()) {
  return {
    ...present(l, nowMs),
    timeline: timeline(l),
    documents: {
      checkin: doc(l.checkin_hash),
      checkout: doc(l.checkout_hash),
      counter_checkout: doc(l.counter_checkout_hash),
      claim: doc(l.claim?.items_hash),
      dispute: doc(l.dispute_reason_hash),
      assessment: doc(l.assessment?.reason_hash),
      attestation: doc(l.assessment?.attestation_hash),
      appeal: doc(l.appeal?.reason_hash),
      ruling: doc(l.ruling?.reason_hash),
    },
  };
}

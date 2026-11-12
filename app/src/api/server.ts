// Keyback HTTP API (Fastify). Read endpoints for any UI, an evidence store, a
// CSV export, proof verification, and (DEMO_SIGNER=1 only) a demo signer that
// acts as the fictional characters so the whole flow can be clicked through.
//
// In production a wallet signs every transaction; this server never holds
// user keys. See README "Trust model".
import cors from "@fastify/cors";
import Fastify, { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { RULES } from "../assessor/rules.js";
import { verifyProof } from "../assessor/nearai.js";
import { assessorUsesNearAi, config } from "../lib/config.js";
import {
  ClaimDoc,
  DisputeDoc,
  Lease,
  Report,
  validateClaim,
  validateReport,
  validateText,
} from "../lib/domain.js";
import { usd } from "../lib/near.js";
import { Conflict, NotFound, Keyback } from "../lib/keyback.js";
import { DeployState, keyFor, loadState, publicState } from "../lib/state.js";
import { TamperedError, blobDir, get, hashOf, put } from "../lib/store.js";
import { flushMirror, restoreBlobs } from "../lib/mirror.js";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { checkin, checkoutClean, checkoutDamaged, checkoutDoctored, fairClaim, inflatedClaim } from "../samples.js";
import { iso, present, presentDetail } from "./present.js";
import { startWorker } from "./worker.js";

class BadRequest extends Error {
  constructor(readonly details: string[]) {
    super(details.join("; "));
  }
}

// ---------------------------------------------------------------- tiny cache

/** Short-lived read cache so a busy UI does not hammer the public RPC. */
function cached<T>(ttlMs: number) {
  const m = new Map<string, { at: number; v: Promise<T> }>();
  return {
    get(key: string, load: () => Promise<T>): Promise<T> {
      const hit = m.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return hit.v;
      const v = load();
      m.set(key, { at: Date.now(), v });
      v.catch(() => m.delete(key));
      return v;
    },
    clear: () => m.clear(),
  };
}

export async function buildServer(state: DeployState) {
  const r = new Keyback(state);
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    genReqId: (req) => (req.headers["x-request-id"] as string) || randomUUID(),
    bodyLimit: 1_000_000,
  });
  await app.register(cors, { origin: true });
  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });

  const leasesCache = cached<Lease[]>(2_000);
  const allLeases = () => leasesCache.get("all", () => r.allLeases());
  const invalidate = () => leasesCache.clear();

  // ------------------------------------------------------------ errors
  app.setErrorHandler((err: any, req, reply) => {
    const msg: string = err?.message ?? String(err);
    if (err instanceof BadRequest) return reply.code(400).send({ error: "invalid_request", details: err.details });
    if (err instanceof NotFound) return reply.code(404).send({ error: "not_found", message: msg });
    if (err instanceof Conflict) return reply.code(409).send({ error: "conflict", message: msg });
    if (err instanceof TamperedError) return reply.code(500).send({ error: "evidence_tampered", message: msg });
    if (err?.validation) return reply.code(400).send({ error: "invalid_request", message: msg });
    // Framework errors that already carry a client status (bad JSON, body too large, ...)
    if (typeof err?.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: "invalid_request", message: msg });
    }
    // A contract `require!` failure: surface the contract's own reason.
    const panic =
      /(?:Smart )?[Cc]ontract panicked: ([^"\n]+)/.exec(msg) ?? /panicked at[^:]*: ([^"\n]+)/.exec(msg);
    if (panic) return reply.code(409).send({ error: "rejected_by_contract", message: panic[1].trim() });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: "internal", message: "Something went wrong. Quote the x-request-id when reporting it." });
  });

  // ------------------------------------------------------------ health
  app.get("/healthz", async () => ({ ok: true }));
  app.get("/readyz", async (_req, reply) => {
    try {
      const cfg = await r.config();
      return { ok: true, lease_count: cfg.lease_count };
    } catch (e) {
      return reply.code(503).send({ ok: false, error: (e as Error).message });
    }
  });

  // ------------------------------------------------------------ deployment + rules
  app.get("/v1/deployment", async () => ({
    ...publicState(state),
    explorer: config.explorer,
    assessor_engine: assessorUsesNearAi() ? `nearai:${config.nearAiModel}` : "rules-v1",
    demo_signer: config.demoSigner,
    token: { id: state.tokenId, symbol: "tUSD", decimals: 6 },
  }));
  app.get("/v1/rules", async () => ({ rules: RULES }));

  // ------------------------------------------------------------ leases
  app.get<{ Querystring: { account?: string; state?: string; role?: string } }>("/v1/leases", async (req) => {
    const { account, state: st, role } = req.query;
    let ls = await allLeases();
    if (account) ls = ls.filter((l) => (role === "landlord" ? l.landlord === account : role === "tenant" ? l.tenant === account : l.landlord === account || l.tenant === account));
    if (st) ls = ls.filter((l) => l.state === st);
    const now = Date.now();
    return { leases: ls.map((l) => present(l, now)).reverse() };
  });

  app.get<{ Params: { id: string } }>("/v1/leases/:id", async (req) => {
    const id = parseId(req.params.id);
    return presentDetail(await r.mustLease(id));
  });

  app.get<{ Params: { id: string } }>("/v1/leases/:id/proof", async (req) => {
    const l = await r.mustLease(parseId(req.params.id));
    if (!l.assessment) throw new NotFound("this lease has no assessment yet");
    const att = get<any>(l.assessment.attestation_hash);
    if (!att) throw new NotFound("proof document not in this server's evidence store");
    if (att.kind === "rules-engine") {
      return { kind: "rules-engine", tee: false, checks: [{ name: "Assessed by the open rule engine (no TEE)", ok: true, detail: "src/assessor/rules.ts" }] };
    }
    // Re-run every check now, from the stored bundle, rather than trusting the saved result.
    const checks = verifyProof(att.proof);
    return { kind: "nearai", tee: true, model: att.proof.model, chat_id: att.proof.chat_id, verified: checks.every((c) => c.ok), checks };
  });

  // ------------------------------------------------------------ accounts + records
  app.get<{ Params: { id: string } }>("/v1/accounts/:id", async (req) => {
    const id = req.params.id;
    const [record, claimable, balance, leases] = await Promise.all([
      r.record(id),
      r.claimable(id),
      r.tokenBalance(id).catch(() => "0"),
      r.leasesOf(id),
    ]);
    return { account: id, record: withDerived(record), claimable, balance, leases: leases.map((l) => present(l)).reverse() };
  });

  /** Public landlord leaderboard, built from on-chain records. */
  app.get("/v1/landlords", async () => {
    const ls = await allLeases();
    const ids = [...new Set(ls.map((l) => l.landlord))];
    const rows = await Promise.all(ids.map(async (id) => ({ account: id, ...withDerived(await r.record(id)) })));
    rows.sort((a, b) => b.score - a.score || b.landlord_settled - a.landlord_settled);
    return { landlords: rows };
  });

  // ------------------------------------------------------------ CSV export
  app.get<{ Querystring: { account?: string } }>("/v1/export.csv", async (req, reply) => {
    const acct = req.query.account;
    let ls = await allLeases();
    if (acct) ls = ls.filter((l) => l.landlord === acct || l.tenant === acct);
    const rows = [
      ["lease_id", "label", "landlord", "tenant", "state", "deposit_usd", "returned_to_tenant_usd", "paid_to_landlord_usd", "claimed_usd", "assessed_usd", "ruled_usd", "funded_at_utc", "moved_out_at_utc", "settled_at_utc", "contract"],
      ...ls.map((l) => [
        l.id, l.label, l.landlord, l.tenant, l.state,
        dollars(l.deposit), dollars(l.paid_to_tenant), dollars(l.paid_to_landlord),
        l.claim ? dollars(l.claim.amount) : "", l.assessment ? dollars(l.assessment.to_landlord) : "", l.ruling ? dollars(l.ruling.to_landlord) : "",
        iso(l.funded_at) ?? "", iso(l.moveout_at) ?? "", iso(l.settled_at) ?? "", state.contractId,
      ]),
    ];
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", `attachment; filename="keyback-${acct ?? "all"}.csv"`);
    return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
  });

  // ------------------------------------------------------------ evidence store
  app.get<{ Params: { hash: string } }>("/v1/documents/:hash", async (req) => {
    const d = get(req.params.hash);
    if (!d) throw new NotFound("no document with that hash");
    return d;
  });

  /** Store a document before a wallet signs the transaction that references its hash. */
  app.post<{ Body: { type: string; doc: any } }>("/v1/documents", async (req) => {
    const { type, doc } = req.body ?? ({} as any);
    const errs = validateDoc(type, doc);
    if (errs.length) throw new BadRequest(errs);
    const hash = put(doc);
    await flushMirror();
    return { hash };
  });

  app.post<{ Body: { type: string; doc: any } }>("/v1/documents/hash", async (req) => {
    const { type, doc } = req.body ?? ({} as any);
    const errs = validateDoc(type, doc);
    if (errs.length) throw new BadRequest(errs);
    return { hash: hashOf(doc) };
  });

  /** Templates for the UI: fictional sample reports and claims. */
  app.get<{ Params: { kind: string }; Querystring: { lease_id?: string } }>("/v1/samples/:kind", async (req) => {
    const id = Number(req.query.lease_id ?? 0);
    const m: Record<string, () => unknown> = {
      checkin: () => checkin(id),
      checkout_clean: () => checkoutClean(id),
      checkout_damaged: () => checkoutDamaged(id),
      checkout_doctored: () => checkoutDoctored(id),
      claim_fair: () => fairClaim(id),
      claim_inflated: () => inflatedClaim(id),
    };
    if (!m[req.params.kind]) throw new NotFound(`samples: ${Object.keys(m).join(", ")}`);
    return m[req.params.kind]();
  });

  // ------------------------------------------------------------ demo signer
  if (config.demoSigner) {
    app.post<{ Body: DemoAction }>("/v1/demo/actions", async (req) => {
      const out = await runDemoAction(r, state, req.body);
      invalidate();
      return out;
    });
  }

  return app;
}

// ---------------------------------------------------------------- helpers

function parseId(s: string): number {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0) throw new BadRequest(["lease id must be a non-negative integer"]);
  return n;
}

const dollars = (units: string) => usd(units).replace(/[$,]/g, "");
const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s;
};

function withDerived(rec: Awaited<ReturnType<Keyback["record"]>>) {
  const held = BigInt(rec.deposits_held);
  const returnedPct = held > 0n ? Number((BigInt(rec.returned_to_tenants) * 1000n) / held) / 10 : null;
  const avgDays = rec.landlord_settled ? rec.return_secs_total / rec.landlord_settled / 86400 : null;
  // Simple, explainable score: share of deposit returned, minus lost disputes.
  const score = rec.landlord_settled === 0 ? 0 : Math.max(0, Math.round((returnedPct ?? 0) - 10 * rec.disputes_lost));
  return { ...rec, returned_pct: returnedPct, avg_days_to_settle: avgDays, score };
}

function validateDoc(type: string, doc: any): string[] {
  switch (type) {
    case "report":
      return validateReport(doc);
    case "claim":
      return validateClaim(doc);
    case "dispute":
    case "appeal":
    case "ruling":
      return validateText(doc);
    default:
      return ["type must be report, claim, dispute, appeal or ruling"];
  }
}

type DemoAction = {
  as: string;
  action: string;
  lease_id?: number;
  terms?: { tenant: string; deposit_usd: number; label: string; lease_ends_in_secs?: number; window_secs?: number };
  report?: Report;
  claim?: ClaimDoc;
  text?: string;
  to_landlord?: string;
};

async function runDemoAction(r: Keyback, s: DeployState, a: DemoAction) {
  if (!a || typeof a.as !== "string" || typeof a.action !== "string") throw new BadRequest(["as and action are required"]);
  const who = a.as === "assessor" ? s.assessor : a.as === "arbiter" ? s.arbiter : keyFor(s, a.as);
  const id = a.lease_id ?? -1;
  const needId = () => {
    if (!Number.isInteger(id) || id < 0) throw new BadRequest(["lease_id is required"]);
    return id;
  };
  const text = (field = "text") => {
    const e = validateText(a, field);
    if (e.length) throw new BadRequest(e);
    return a.text!;
  };
  switch (a.action) {
    case "create_lease": {
      const t = a.terms;
      if (!t || typeof t.tenant !== "string" || !(t.deposit_usd > 0) || typeof t.label !== "string") {
        throw new BadRequest(["terms.tenant, terms.deposit_usd and terms.label are required"]);
      }
      const w = t.window_secs ?? 60;
      const leaseId = await r.createLease(who, {
        tenant: keyFor(s, t.tenant).id,
        deposit: (BigInt(Math.round(t.deposit_usd * 100)) * 10_000n).toString(),
        label: t.label,
        lease_ends_in_secs: t.lease_ends_in_secs ?? 0,
        claim_window_secs: w,
        response_window_secs: w,
        appeal_window_secs: w,
      });
      return { ok: true, lease_id: leaseId };
    }
    case "fund":
      await r.fund(who, needId());
      break;
    case "sign_checkin":
    case "submit_checkout":
    case "counter_checkout": {
      const rep = a.report ?? (a.action === "sign_checkin" ? checkin(needId()) : checkoutDamaged(needId()));
      const e = validateReport(rep);
      if (e.length) throw new BadRequest(e);
      const h =
        a.action === "sign_checkin"
          ? await r.signCheckin(who, needId(), rep)
          : a.action === "submit_checkout"
            ? await r.submitCheckout(who, needId(), rep)
            : await r.counterCheckout(who, needId(), rep);
      return { ok: true, hash: h };
    }
    case "return_in_full":
      await r.returnInFull(who, needId());
      break;
    case "file_claim": {
      const c = a.claim ?? inflatedClaim(needId());
      const e = validateClaim(c);
      if (e.length) throw new BadRequest(e);
      return { ok: true, hash: await r.fileClaim(who, needId(), c) };
    }
    case "accept_claim":
      await r.acceptClaim(who, needId());
      break;
    case "dispute": {
      const d: DisputeDoc = { lease_id: needId(), by: who.id, text: text() };
      return { ok: true, hash: await r.dispute(who, needId(), d) };
    }
    case "appeal": {
      const d: DisputeDoc = { lease_id: needId(), by: who.id, text: text() };
      return { ok: true, hash: await r.appeal(who, needId(), d) };
    }
    case "assess": {
      const out = await r.assess(needId());
      return { ok: true, assessment: out.doc, checks: out.checks };
    }
    case "rule": {
      if (!a.to_landlord || !/^[0-9]+$/.test(a.to_landlord)) throw new BadRequest(["to_landlord (tUSD units) is required"]);
      return { ok: true, hash: await r.rule(who, needId(), { lease_id: needId(), by: who.id, to_landlord: a.to_landlord, text: text() }) };
    }
    case "cancel":
      await r.cancel(who, needId());
      break;
    case "finalize":
      await r.finalize(who, needId());
      break;
    case "withdraw":
      await r.withdraw(who);
      break;
    default:
      throw new BadRequest([`unknown action "${a.action}"`]);
  }
  return { ok: true };
}

// ---------------------------------------------------------------- main

if (process.argv[1] && /server\.(ts|js)$/.test(process.argv[1])) {
  const state = loadState();
  const restored = await restoreBlobs(blobDir());
  const app = await buildServer(state);
  if (restored) app.log.info({ restored }, "restored evidence blobs from the database");
  // When WEB_DIST points at a built web/ folder, serve the site from the same origin.
  const web = process.env.WEB_DIST ? resolve(process.env.WEB_DIST) : "";
  if (web && existsSync(web)) await app.register(fastifyStatic, { root: web });
  const stopWorker = process.env.RUN_WORKER === "0" ? () => {} : startWorker(state, app.log);
  const shutdown = async (sig: string) => {
    app.log.info({ sig }, "shutting down");
    stopWorker();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  await app.listen({ port: config.port, host: config.host });
}

export type { FastifyRequest, FastifyReply };

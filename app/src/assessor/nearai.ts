// Private AI assessment on NEAR AI Cloud, with proof of where it ran.
//
// 1. Fetch the model's TEE attestation with a fresh random nonce.
// 2. Send the case to a privately hosted model (inside the TEE).
// 3. Fetch the TEE's signature over sha256(request) and sha256(response).
// 4. Verify: hashes match what we sent and received, the signature recovers to
//    the attested signing address, and the nonce is in the report.
// The whole bundle is stored; its sha256 goes on-chain with the verdict.
import { randomBytes } from "node:crypto";
import { verifyMessage } from "ethers";
import { config } from "../lib/config.js";
import { AssessedItem, AssessmentDoc, ClaimDoc, DisputeDoc, Report } from "../lib/domain.js";
import { sha256 } from "../lib/store.js";
import { RULES, assessWithRules } from "./rules.js";

export type ProofBundle = {
  model: string;
  chat_id: string;
  request_body: string;
  response_body: string;
  signature: { text: string; signature: string; signing_address: string; signing_algo: string; signature_kind?: string };
  attestation: { nonce: string; report: unknown };
  fetched_at: string;
};

export type Check = { name: string; ok: boolean; detail: string };

const headers = () => ({
  authorization: `Bearer ${config.nearAiKey}`,
  "content-type": "application/json",
  accept: "application/json",
});

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

const SYSTEM = `You are an impartial rent deposit assessor. A landlord has claimed deductions from a tenant's deposit and the tenant disputes them.
Apply these rules strictly and cite one rule id per item:
${RULES.join("\n")}
Amounts are integers in tUSD units (1 tUSD = 1000000 units). Never award more than claimed per item.
Reply with JSON only, no prose outside it:
{"items":[{"room":string,"item":string,"claimed":string,"allowed":string,"rule":"R1".."R7","reason":string}],"confidence_bps":integer 0-10000,"summary":string}`;

function caseText(checkin: Report, checkout: Report, claim: ClaimDoc, dispute: DisputeDoc | null) {
  return JSON.stringify({
    move_in_report: checkin,
    move_out_report: checkout,
    landlord_claim: claim,
    tenant_dispute: dispute ? dispute.text : null,
  });
}

/** Turns the model's reply into a safe AssessmentDoc: clamps, recomputes totals, fills gaps. */
export function parseModelReply(raw: string, claim: ClaimDoc, model: string): AssessmentDoc {
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  const r = JSON.parse(json);
  const items: AssessedItem[] = claim.items.map((ci) => {
    const m = (r.items ?? []).find(
      (x: any) => String(x.room).toLowerCase() === ci.room.toLowerCase() && String(x.item).toLowerCase() === ci.item.toLowerCase(),
    );
    const claimed = BigInt(ci.amount);
    let allowed = 0n;
    try {
      allowed = BigInt(String(m?.allowed ?? "0").replace(/[^0-9]/g, "") || "0");
    } catch {
      allowed = 0n;
    }
    if (allowed > claimed) allowed = claimed;
    return {
      room: ci.room,
      item: ci.item,
      claimed: claimed.toString(),
      allowed: allowed.toString(),
      rule: typeof m?.rule === "string" ? m.rule.slice(0, 4) : "R1",
      reason: typeof m?.reason === "string" ? m.reason.slice(0, 500) : "The assessor gave no reason for this item, so nothing is allowed.",
    };
  });
  const to_landlord = items.reduce((s, i) => s + BigInt(i.allowed), 0n);
  const conf = Number.isInteger(r.confidence_bps) ? Math.min(10_000, Math.max(0, r.confidence_bps)) : 5_000;
  return {
    lease_id: claim.lease_id,
    engine: `nearai:${model}`,
    to_landlord: to_landlord.toString(),
    confidence_bps: conf,
    items,
    summary: typeof r.summary === "string" ? r.summary.slice(0, 1000) : "",
  };
}

export async function assessWithNearAi(
  checkin: Report,
  checkout: Report,
  claim: ClaimDoc,
  dispute: DisputeDoc | null,
): Promise<{ doc: AssessmentDoc; proof: ProofBundle; checks: Check[] }> {
  const model = config.nearAiModel;
  const nonce = randomBytes(32).toString("hex");
  const report = await getJson(
    `${config.nearAiBase}/attestation/report?model=${encodeURIComponent(model)}&signing_algo=ecdsa&nonce=${nonce}`,
  );

  const request_body = JSON.stringify({
    model,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: caseText(checkin, checkout, claim, dispute) },
    ],
  });
  const res = await fetch(`${config.nearAiBase}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: request_body,
    signal: AbortSignal.timeout(120_000),
  });
  const response_body = await res.text();
  if (!res.ok) throw new Error(`NEAR AI chat -> ${res.status} ${response_body.slice(0, 300)}`);
  const completion = JSON.parse(response_body);
  const chat_id: string = completion.id;
  const content: string = completion.choices?.[0]?.message?.content ?? "";

  const signature = await getJson(
    `${config.nearAiBase}/signature/${encodeURIComponent(chat_id)}?model=${encodeURIComponent(model)}&signing_algo=ecdsa`,
  );

  const proof: ProofBundle = {
    model,
    chat_id,
    request_body,
    response_body,
    signature,
    attestation: { nonce, report },
    fetched_at: new Date().toISOString(),
  };
  const checks = verifyProof(proof);
  let doc: AssessmentDoc;
  try {
    doc = parseModelReply(content, claim, model);
  } catch (e) {
    // An unreadable reply must not decide anyone's money: fall back to the rules.
    doc = { ...assessWithRules(checkin, checkout, claim), summary: `Model reply unreadable (${(e as Error).message}); rules applied.` };
  }
  return { doc, proof, checks };
}

/** Every check a judge can re-run from the stored bundle alone. */
export function verifyProof(p: ProofBundle): Check[] {
  const reqHash = sha256(p.request_body);
  const resHash = sha256(p.response_body);
  const parts = String(p.signature?.text ?? "").split(":");
  const signedHashes = parts.slice(-2);
  const checks: Check[] = [];

  checks.push({
    name: "Request hash matches",
    ok: signedHashes[0] === reqHash,
    detail: `sha256(request) = ${reqHash.slice(0, 16)}...`,
  });
  checks.push({
    name: "Response hash matches",
    ok: signedHashes[1] === resHash,
    detail: `sha256(response) = ${resHash.slice(0, 16)}...`,
  });

  let recovered = "";
  try {
    recovered = verifyMessage(p.signature.text, p.signature.signature);
  } catch {
    recovered = "";
  }
  const signer = String(p.signature?.signing_address ?? "");
  checks.push({
    name: "Signature recovers to the signing address",
    ok: recovered !== "" && recovered.toLowerCase() === signer.toLowerCase(),
    detail: `recovered ${recovered || "nothing"}`,
  });

  const reportText = JSON.stringify(p.attestation.report ?? {}).toLowerCase();
  const attested = signer !== "" && reportText.includes(signer.toLowerCase().replace(/^0x/, ""));
  checks.push({
    name: "Signing address is in the TEE attestation",
    ok: attested,
    detail: p.signature?.signature_kind === "gateway" ? "gateway TEE signature" : "model TEE signature",
  });
  checks.push({
    name: "Attestation is fresh (our nonce is in the report)",
    ok: reportText.includes(p.attestation.nonce.toLowerCase()),
    detail: `nonce ${p.attestation.nonce.slice(0, 16)}...`,
  });
  checks.push({
    name: "Model is the private TEE model",
    ok: parts.length < 3 || parts[0] === p.model,
    detail: p.model,
  });
  return checks;
}

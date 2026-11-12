import { test } from "node:test";
import assert from "node:assert/strict";
import { Wallet } from "ethers";
import { parseModelReply, verifyProof, ProofBundle } from "./nearai.js";
import { sha256 } from "../lib/store.js";
import type { ClaimDoc } from "../lib/domain.js";

const claim: ClaimDoc = {
  lease_id: 1,
  items: [
    { room: "Kitchen", item: "Oven", amount: "100", reason: "broken" },
    { room: "Bedroom", item: "Door", amount: "50", reason: "scratched" },
  ],
};

test("model reply is clamped to the claim and totals recomputed", () => {
  const raw = 'Sure! {"items":[{"room":"kitchen","item":"OVEN","allowed":"999","rule":"R4","reason":"x"}],"confidence_bps":99999,"summary":"s"}';
  const d = parseModelReply(raw, claim, "m");
  assert.equal(d.items[0].allowed, "100"); // clamped
  assert.equal(d.items[1].allowed, "0"); // missing from reply -> nothing allowed
  assert.equal(d.to_landlord, "100");
  assert.equal(d.confidence_bps, 10000);
});

async function bundle(tamper = false): Promise<ProofBundle> {
  const w = Wallet.createRandom();
  const request_body = '{"a":1}';
  const response_body = '{"b":2}';
  const nonce = "ab".repeat(32);
  const text = `m:${sha256(request_body)}:${sha256(tamper ? "other" : response_body)}`;
  return {
    model: "m",
    chat_id: "c",
    request_body,
    response_body,
    signature: { text, signature: await w.signMessage(text), signing_address: w.address, signing_algo: "ecdsa" },
    attestation: { nonce, report: { request_nonce: nonce, model_attestations: [{ signing_address: w.address }] } },
    fetched_at: "now",
  };
}

test("a genuine bundle passes every check", async () => {
  const checks = verifyProof(await bundle());
  assert.deepEqual(checks.filter((c) => !c.ok), []);
});

test("an edited response fails the response-hash check", async () => {
  const checks = verifyProof(await bundle(true));
  assert.equal(checks.find((c) => c.name === "Response hash matches")!.ok, false);
});

test("a forged signature fails", async () => {
  const b = await bundle();
  b.signature.signing_address = Wallet.createRandom().address;
  const checks = verifyProof(b);
  assert.equal(checks.find((c) => c.name.startsWith("Signature"))!.ok, false);
});

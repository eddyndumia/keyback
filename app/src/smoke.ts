// API smoke test against a running server started with DEMO_SIGNER=1.
// Drives one disputed lease through the HTTP API and waits for the background
// worker to assess it and, after the appeal window, to finalize it.
// Run: DEMO_SIGNER=1 npm run api   (in one terminal)   then   npm run smoke
const B = process.env.API ?? "http://127.0.0.1:8787";
let failures = 0;

async function req(method: string, path: string, body?: unknown) {
  const r = await fetch(`${B}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: r.status, json };
}

function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const act = (body: Record<string, unknown>) => req("POST", "/v1/demo/actions", body);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(id: number, states: string[], maxMs: number) {
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    const l = (await req("GET", `/v1/leases/${id}`)).json;
    if (states.includes(l.state)) return l;
    await sleep(2000);
  }
  return (await req("GET", `/v1/leases/${id}`)).json;
}

async function main() {
  check("readyz", (await req("GET", "/readyz")).status === 200);
  const dep = (await req("GET", "/v1/deployment")).json;
  check("demo signer enabled", dep.demo_signer === true, "start the API with DEMO_SIGNER=1");

  const bad = await fetch(`${B}/v1/documents`, { method: "POST", headers: { "content-type": "application/json" }, body: "{oops" });
  check("malformed JSON is a 400", bad.status === 400, String(bad.status));
  const inv = await req("POST", "/v1/documents", { type: "claim", doc: { lease_id: 1, items: [] } });
  check("invalid claim is rejected with reasons", inv.status === 400 && Array.isArray(inv.json.details));
  check("unknown lease is a 404", (await req("GET", "/v1/leases/999999")).status === 404);

  const created = await act({ as: "sofia", action: "create_lease", terms: { tenant: "lucas", deposit_usd: 500, label: "Room 5, Hill View", window_secs: 30 } });
  check("create lease", created.status === 200, JSON.stringify(created.json));
  const id: number = created.json.lease_id;

  const wrongParty = await act({ as: "priya", action: "fund", lease_id: id });
  check("wrong tenant cannot fund (refunded by token)", wrongParty.status === 409, wrongParty.json?.message);

  for (const [as, action] of [
    ["lucas", "fund"],
    ["sofia", "sign_checkin"],
    ["lucas", "sign_checkin"],
    ["lucas", "submit_checkout"],
    ["sofia", "file_claim"],
  ] as const) {
    const r = await act({ as, action, lease_id: id });
    check(`${as} ${action}`, r.status === 200, r.status === 200 ? "" : JSON.stringify(r.json));
  }

  const early = await act({ as: "sofia", action: "finalize", lease_id: id });
  check("finalize before the deadline is refused by the contract", early.status === 409, early.json?.message);

  const d = await act({ as: "lucas", action: "dispute", lease_id: id, text: "Normal wear only, except the window." });
  check("tenant disputes", d.status === 200);

  const assessed = await waitFor(id, ["Assessed", "Settled"], 45_000);
  check("worker assessed the dispute", assessed.state === "Assessed" || assessed.state === "Settled", assessed.state);
  check("assessment document is resolvable", Boolean(assessed.documents?.assessment?.items?.length));
  const proof = await req("GET", `/v1/leases/${id}/proof`);
  check("proof endpoint answers", proof.status === 200, proof.json?.kind);

  const settled = await waitFor(id, ["Settled"], 75_000);
  check("keeper finalized after the appeal window", settled.state === "Settled", settled.state);
  check("money adds up", BigInt(settled.paid_to_tenant) + BigInt(settled.paid_to_landlord) === BigInt(settled.deposit));

  const csv = await fetch(`${B}/v1/export.csv`);
  check("CSV export", csv.status === 200 && (await csv.text()).startsWith("lease_id,"));
  const board = (await req("GET", "/v1/landlords")).json;
  check("landlord leaderboard", Array.isArray(board.landlords) && board.landlords.length > 0);

  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

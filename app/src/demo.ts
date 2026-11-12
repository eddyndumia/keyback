// End-to-end demo on NEAR testnet: four fictional Nairobi leases.
//   A  good landlord returns the deposit in full
//   B  fair claim for real damage, tenant accepts; the rest comes back at once
//   C  inflated claim, tenant disputes, assessor rules, landlord appeals, arbiter decides
//   D  landlord goes silent; the deadline passes and the tenant gets everything
// Run: npm run setup && npm run demo   (add -- --only=C to run one scenario)
import { config, assessorUsesNearAi } from "./lib/config.js";
import { Key, toUnits, usd } from "./lib/near.js";
import { Rudisha } from "./lib/rudisha.js";
import { loadState } from "./lib/state.js";
import { checkin, checkoutClean, checkoutDamaged, checkoutDoctored, fairClaim, inflatedClaim } from "./samples.js";

const s = loadState();
const r = new Rudisha(s);
const P = s.people;
const WINDOW = 30; // seconds: every window is shortened for the demo
const DEPOSIT = toUnits(500).toString();
const only = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];

const say = (msg: string) => console.log(`  ${msg}`);
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function newLease(landlord: Key, tenant: Key, label: string): Promise<number> {
  const id = await r.createLease(landlord, {
    tenant: tenant.id,
    deposit: DEPOSIT,
    label,
    lease_ends_in_secs: 0,
    claim_window_secs: WINDOW,
    response_window_secs: WINDOW,
    appeal_window_secs: WINDOW,
  });
  say(`lease #${id} "${label}": deposit ${usd(DEPOSIT)}`);
  await r.fund(tenant, id);
  say(`tenant paid ${usd(DEPOSIT)} into the contract (not to the landlord)`);
  await r.signCheckin(landlord, id, checkin(id));
  await r.signCheckin(tenant, id, checkin(id));
  say("both signed the same move-in report: lease is active");
  return id;
}

async function showMoney(id: number, tenant: Key, landlord: Key) {
  // Public RPC nodes can lag a block behind the write we just made: wait for it to land.
  let l = await r.mustLease(id);
  for (let i = 0; i < 10 && !["Settled", "Cancelled"].includes(l.state); i++) {
    await sleep(1000);
    l = await r.mustLease(id);
  }
  say(`state=${l.state} | tenant got ${usd(l.paid_to_tenant)} | landlord got ${usd(l.paid_to_landlord)}`);
  say(`claimable now: tenant ${usd(await r.claimable(tenant.id))}, landlord ${usd(await r.claimable(landlord.id))}`);
}

const scenarios: Record<string, [string, () => Promise<void>]> = {
  A: ["Good landlord returns the deposit in full", async () => {
    const id = await newLease(P.mwangi, P.achieng, "Kilimani 1BR");
    await r.submitCheckout(P.achieng, id, checkoutClean(id));
    say("move-out report recorded: only light scuffs (normal wear)");
    await r.returnInFull(P.mwangi, id);
    say("landlord returned the deposit in full");
    await showMoney(id, P.achieng, P.mwangi);
    const before = BigInt(await r.tokenBalance(P.achieng.id));
    await r.withdraw(P.achieng);
    say(`tenant withdrew: wallet ${usd(before)} -> ${usd(await r.tokenBalance(P.achieng.id))}`);
  }],
  B: ["Fair claim for real damage, accepted", async () => {
    const id = await newLease(P.mwangi, P.otieno, "Westlands 2BR");
    await r.submitCheckout(P.otieno, id, checkoutDamaged(id));
    say("move-out report: cracked window, some normal wear");
    await r.fileClaim(P.mwangi, id, fairClaim(id));
    say(`landlord claimed ${usd(toUnits(60))} for the window; the other ${usd(toUnits(440))} went back to the tenant immediately`);
    await r.acceptClaim(P.otieno, id);
    say("tenant accepted the claim");
    await showMoney(id, P.otieno, P.mwangi);
  }],
  C: ["Inflated claim, dispute, assessment, appeal, ruling", async () => {
    const id = await newLease(P.kamau, P.wanjiru, "Kilimani 2BR");
    await r.submitCheckout(P.wanjiru, id, checkoutDamaged(id));
    say("move-out report: cracked window, scuffed walls, faded sofa");
    await r.fileClaim(P.kamau, id, inflatedClaim(id));
    say(`landlord claimed ${usd(toUnits(450))} (window + repaint + new sofa + cleaning); ${usd(toUnits(50))} released to the tenant now`);
    await r.dispute(P.wanjiru, id, {
      lease_id: id,
      by: P.wanjiru.id,
      text: "I accept the window. The walls and sofa are normal wear after a year, and the cooker was left clean.",
      contested: ["Walls", "Sofa", "Cooker"],
    });
    say("tenant disputed the repaint, sofa and cleaning");
    const engine = assessorUsesNearAi() ? `NEAR AI private model (${config.nearAiModel}) in a TEE` : "open rule engine (no NEAR AI key set)";
    const a = await r.assess(id);
    say(`assessor [${engine}] awarded ${usd(a.doc.to_landlord)} of ${usd(toUnits(450))}:`);
    for (const it of a.doc.items) say(`   ${it.rule}  ${it.item.padEnd(9)} ${usd(it.claimed).padStart(8)} -> ${usd(it.allowed).padStart(8)}  ${it.reason}`);
    await r.appeal(P.kamau, id, { lease_id: id, by: P.kamau.id, text: "The flat needs repainting before I can let it again." });
    say("landlord appealed to the human arbiter");
    await r.rule(s.arbiter, id, {
      lease_id: id,
      by: s.arbiter.id,
      to_landlord: a.doc.to_landlord,
      text: "Upheld. Repainting after a year of normal use is the landlord's cost.",
    });
    say("arbiter upheld the assessment");
    await showMoney(id, P.wanjiru, P.kamau);
  }],
  E: ["Landlord files a doctored move-out report; the tenant answers it", async () => {
    const id = await newLease(P.kamau, P.otieno, "Kileleshwa 1BR");
    await r.submitCheckout(P.kamau, id, checkoutDoctored(id));
    say("landlord recorded move-out first, writing up scuffed walls and a faded sofa as 'damaged'");
    await r.counterCheckout(P.otieno, id, checkoutDamaged(id));
    say("tenant added their own move-out report: walls and sofa 'fair', window cracked");
    await r.fileClaim(P.kamau, id, inflatedClaim(id));
    say(`landlord claimed ${usd(toUnits(450))}`);
    await r.dispute(P.otieno, id, { lease_id: id, by: P.otieno.id, text: "The landlord's report exaggerates. My report and photos show normal wear." });
    const a = await r.assess(id);
    say(`assessor awarded ${usd(a.doc.to_landlord)} of ${usd(toUnits(450))}:`);
    for (const it of a.doc.items) say(`   ${it.rule}  ${it.item.padEnd(9)} ${usd(it.claimed).padStart(8)} -> ${usd(it.allowed).padStart(8)}`);
    say("nobody appeals; the keeper (or anyone) applies it when the appeal window closes");
    await sleep((WINDOW + 3) * 1000);
    await r.finalize(P.otieno, id);
    await showMoney(id, P.otieno, P.kamau);
  }],
  D: ["Landlord goes silent: the deadline protects the tenant", async () => {
    const id = await newLease(P.kamau, P.achieng, "South B studio");
    await r.submitCheckout(P.achieng, id, checkoutClean(id));
    say(`move-out recorded; the landlord has ${WINDOW}s to claim (30 days in production) and says nothing...`);
    await sleep((WINDOW + 3) * 1000);
    await r.finalize(P.achieng, id);
    say("claim window closed: the tenant triggered finalize and gets the full deposit");
    await showMoney(id, P.achieng, P.kamau);
  }],
};

async function main() {
  console.log(`Rudisha demo on ${s.network}: contract ${s.contractId}`);
  console.log(`Assessor: ${assessorUsesNearAi() ? `NEAR AI ${config.nearAiModel}` : "rule engine (set NEARAI_API_KEY for the private TEE model)"}\n`);
  for (const [k, [title, run]] of Object.entries(scenarios)) {
    if (only && only !== k) continue;
    console.log(`${k}. ${title}`);
    await run();
    console.log("");
  }
  console.log("Public landlord records (on-chain):");
  for (const name of ["mwangi", "kamau"]) {
    const rec = await r.record(P[name].id);
    const avg = rec.landlord_settled ? Math.round(rec.return_secs_total / rec.landlord_settled) : 0;
    say(
      `${name.padEnd(7)} leases ${rec.landlord_leases} | settled ${rec.landlord_settled} | full returns ${rec.full_returns} | claims ${rec.claims_filed} | disputes ${rec.disputes_faced} (lost ${rec.disputes_lost}) | returned ${usd(rec.returned_to_tenants)} of ${usd(rec.deposits_held)} | avg ${avg}s to settle`,
    );
  }
  console.log(`\nSee it on-chain: ${config.explorer}/address/${s.contractId}`);
}

main().catch((e) => {
  console.error(`demo failed: ${e?.message ?? e}`);
  process.exit(1);
});

// One-time testnet setup. Needs no keys from us: accounts come from the public faucet.
//
//   rudisha-<tag>.testnet   the Rudisha contract
//   tusd-<tag>.testnet      the test stablecoin (open faucet, testnet only)
//   ops-<tag>.testnet       funds the sub-accounts below
//   assessor.ops-<tag>, arbiter.ops-<tag>, and fictional landlords/tenants
//
// Usage: npm run setup            (skips if already set up)
//        npm run setup -- --fresh (new accounts and contracts)
import { KeyPair, actions, nearToYocto, teraToGas } from "near-api-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, config } from "./lib/config.js";
import { Key, account, accountExists, call, toUnits, usd, view } from "./lib/near.js";
import { DeployState, hasState, saveState, statePath } from "./lib/state.js";

const FAUCET = process.env.NEAR_FAUCET ?? "https://helper.nearprotocol.com/account";
const WASM = (n: string) => readFileSync(join(REPO_ROOT, "contracts", "out", `${n}.wasm`));

const PEOPLE: [string, "landlord" | "tenant"][] = [
  ["mwangi", "landlord"],
  ["kamau", "landlord"],
  ["achieng", "tenant"],
  ["otieno", "tenant"],
  ["wanjiru", "tenant"],
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(id: string) {
  for (let i = 0; i < 30; i++) {
    if (await accountExists(id)) return;
    await sleep(1000);
  }
  throw new Error(`${id} did not appear on testnet`);
}

async function faucet(id: string): Promise<Key> {
  const kp = KeyPair.fromRandom("ed25519");
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(FAUCET, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }),
    });
    if (r.ok) break;
    if (attempt >= 3) throw new Error(`faucet refused ${id}: ${r.status} ${await r.text()}`);
    await sleep(2000 * attempt);
  }
  await waitFor(id);
  return { id, key: kp.toString() };
}

async function main() {
  if (hasState() && !process.argv.includes("--fresh")) {
    console.log(`Already set up: ${statePath()}\nRun "npm run setup -- --fresh" for new accounts.`);
    return;
  }
  const tag = `r${Date.now().toString(36)}`;
  const step = (n: number, s: string) => console.log(`[${n}/6] ${s}`);

  step(1, `Creating faucet accounts (tag ${tag})`);
  const admin = await faucet(`rudisha-${tag}.testnet`);
  const token = await faucet(`tusd-${tag}.testnet`);
  const ops = await faucet(`ops-${tag}.testnet`);

  step(2, "Creating assessor, arbiter and demo characters");
  const opsAcc = account(ops);
  const sub = async (name: string, fund: `${number}`): Promise<Key> => {
    const kp = KeyPair.fromRandom("ed25519");
    const id = `${name}.${ops.id}`;
    await opsAcc.signAndSendTransaction({
      receiverId: id,
      actions: [actions.createAccount(), actions.transfer(nearToYocto(fund)), actions.addFullAccessKey(kp.getPublicKey())],
    });
    return { id, key: kp.toString() };
  };
  const assessor = await sub("assessor", "0.5");
  const arbiter = await sub("arbiter", "0.5");
  const people: DeployState["people"] = {};
  for (const [name, role] of PEOPLE) people[name] = { ...(await sub(name, "1")), role };

  step(3, "Deploying tUSD (test stablecoin)");
  await account(token).signAndSendTransaction({
    receiverId: token.id,
    actions: [actions.deployContract(WASM("tusd")), actions.functionCall("new", {}, teraToGas("30"), 0n)],
  });

  step(4, "Deploying Rudisha");
  await account(admin).signAndSendTransaction({
    receiverId: admin.id,
    actions: [
      actions.deployContract(WASM("rudisha")),
      actions.functionCall(
        "new",
        { admin: admin.id, token: token.id, assessor: assessor.id, arbiter: arbiter.id },
        teraToGas("50"),
        0n,
      ),
    ],
  });

  step(5, "Tenants take tUSD from the test faucet");
  for (const [name, k] of Object.entries(people)) {
    if (k.role !== "tenant") continue;
    await call(account(k), token.id, "mint", { amount: toUnits(5000).toString() }, { tgas: 30 });
    const bal = await view<string>(token.id, "ft_balance_of", { account_id: k.id });
    console.log(`      ${name}: ${usd(bal)} tUSD`);
  }

  const state: DeployState = {
    network: "testnet",
    createdAt: new Date().toISOString(),
    contractId: admin.id,
    tokenId: token.id,
    ops,
    admin,
    assessor,
    arbiter,
    people,
  };
  saveState(state);

  step(6, "Checking the contract answers");
  const cfg = await view<any>(admin.id, "get_config");
  console.log(`      token=${cfg.token} assessor=${cfg.assessor} arbiter=${cfg.arbiter}`);
  console.log(`\nDone.\n  Contract: ${config.explorer}/address/${admin.id}`);
  console.log(`  Keys: ${statePath()} (git-ignored, testnet only)\n  Next: npm run demo`);
}

main().catch((e) => {
  console.error(`setup failed: ${e?.message ?? e}`);
  process.exit(1);
});

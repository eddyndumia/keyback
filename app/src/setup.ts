// One-time testnet setup. Needs no keys from us: accounts come from the public faucet.
//
//   keyback-<tag>.testnet            one faucet account that pays for the rest
//   deposits.keyback-<tag>.testnet   the Keyback contract
//   tusd.keyback-<tag>.testnet       the test stablecoin (open faucet, testnet only)
//   assessor., arbiter., and fictional landlords/tenants as sub-accounts
//
// Usage: npm run setup                (skips if already set up)
//        npm run setup -- --fresh     (new accounts and contracts)
//        npm run setup -- --redeploy  (new contract build, same accounts and token)
import { KeyPair, actions, nearToYocto, teraToGas } from "near-api-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, config } from "./lib/config.js";
import { Key, account, accountExists, call, toUnits, usd, view } from "./lib/near.js";
import { DeployState, hasState, loadState, saveState, statePath } from "./lib/state.js";

const FAUCET = process.env.NEAR_FAUCET ?? "https://helper.nearprotocol.com/account";
const WASM = (n: string) => readFileSync(join(REPO_ROOT, "contracts", "out", `${n}.wasm`));

const PEOPLE: [string, "landlord" | "tenant"][] = [
  ["daniel", "landlord"],
  ["sofia", "landlord"],
  ["amara", "tenant"],
  ["lucas", "tenant"],
  ["priya", "tenant"],
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

async function deployKeyback(ops: Key, name: string, token: string, assessor: string, arbiter: string): Promise<Key> {
  const kp = KeyPair.fromRandom("ed25519");
  const id = `${name}.${ops.id}`;
  await account(ops).signAndSendTransaction({
    receiverId: id,
    actions: [
      actions.createAccount(),
      actions.transfer(nearToYocto("2.6")),
      actions.addFullAccessKey(kp.getPublicKey()),
      actions.deployContract(WASM("keyback")),
      actions.functionCall("new", { admin: id, token, assessor, arbiter }, teraToGas("50"), 0n),
    ],
  });
  return { id, key: kp.toString() };
}

async function main() {
  // --redeploy: keep accounts and token, deploy the current contract build to a new sub-account.
  if (process.argv.includes("--redeploy")) {
    const old = loadState();
    const name = `v${Date.now().toString(36)}`;
    console.log(`Redeploying Keyback to ${name}.${old.ops.id} (no faucet needed)`);
    const admin = await deployKeyback(old.ops, name, old.tokenId, old.assessor.id, old.arbiter.id);
    saveState({ ...old, contractId: admin.id, admin, createdAt: new Date().toISOString() });
    console.log(`Done. Contract: ${config.explorer}/address/${admin.id}`);
    return;
  }
  if (hasState() && !process.argv.includes("--fresh")) {
    console.log(`Already set up: ${statePath()}
Run "npm run setup -- --fresh" for new accounts.`);
    return;
  }
  const tag = `r${Date.now().toString(36)}`;
  const step = (n: number, s: string) => console.log(`[${n}/6] ${s}`);

  // One faucet account; everything else is a sub-account it pays for (faucets rate-limit).
  step(1, `Creating one faucet account: keyback-${tag}.testnet`);
  const ops = await faucet(`keyback-${tag}.testnet`);

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
  const assessor = await sub("assessor", "0.3");
  const arbiter = await sub("arbiter", "0.3");
  const people: DeployState["people"] = {};
  for (const [name, role] of PEOPLE) people[name] = { ...(await sub(name, "0.3")), role };

  step(3, "Deploying tUSD (test stablecoin)");
  const token = await sub("tusd", "1.6");
  await account(token).signAndSendTransaction({
    receiverId: token.id,
    actions: [actions.deployContract(WASM("tusd")), actions.functionCall("new", {}, teraToGas("30"), 0n)],
  });

  step(4, "Deploying Keyback");
  const admin = await deployKeyback(ops, "deposits", token.id, assessor.id, arbiter.id);

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
  console.log(`
Done.
  Contract: ${config.explorer}/address/${admin.id}`);
  console.log(`  Keys: ${statePath()} (git-ignored, testnet only)
  Next: npm run demo`);
}

main().catch((e) => {
  console.error(`setup failed: ${e?.message ?? e}`);
  process.exit(1);
});

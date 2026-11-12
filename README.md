# Keyback

Rent deposit protection on NEAR. The tenant pays the deposit into a contract instead of to the landlord. At move-out the landlord has a fixed window to claim deductions, item by item, against a signed move-in report. Anything not claimed in time goes back to the tenant. A disputed claim goes to a private assessor that has to give a reason for every item, and either side can appeal to a human arbiter. Every landlord gets a public record of how much deposit they actually returned.

Built for the NEAR Hackathon (Real-World Money and Privacy tracks).

- Contract on testnet: [`deposits.keyback-rmwdjbb4t.testnet`](https://testnet.nearblocks.io/address/deposits.keyback-rmwdjbb4t.testnet)
- Test stablecoin (NEP-141, 6 decimals): [`tusd.keyback-rmwdjbb4t.testnet`](https://testnet.nearblocks.io/address/tusd.keyback-rmwdjbb4t.testnet)

## The problem

Deposits are often the largest sum a renter has tied up, and the landlord holds all of it. Getting it back usually means arguing, with no evidence anyone agreed on and no deadline that binds the landlord. England and Wales made deposit protection schemes mandatory in 2007 for this reason. Most of the world has nothing like it.

## What the contract guarantees

These are enforced in `contracts/keyback/src/lib.rs`, not by the server.

1. The deposit sits in the contract. Neither side can take it alone.
2. A deduction needs an item in the signed move-in report. Both sides sign that report before the lease is active.
3. Deadlines are on-chain. If the landlord does not claim within the claim window, the full deposit is releasable to the tenant. If the tenant does not respond, the claim stands.
4. The tenant can file their own move-out report if they disagree with the landlord's. The assessor sees both.
5. An award can never exceed the claim, and the undisputed part is released straight away.
6. Each lease names its own assessor and arbiter at creation, so a judge cannot be swapped mid-dispute.
7. Money moves by pull withdrawal, so a failed transfer never leaves funds in a broken state.
8. A keeper finalises leases after their deadlines, so nobody can stall a payout by doing nothing.

## Try it in 5 minutes

Needs Node 22.5 or newer. No NEAR account, wallet or API key is needed: setup creates fresh testnet accounts from the public faucet.

```bash
cd app && npm install
npm run setup            # creates accounts, deploys keyback.wasm + tusd.wasm to testnet
DEMO_SIGNER=1 npm run api   # API on :8787, runs the assessor and keeper worker too
# second terminal
cd web && npm install && npx vite   # UI on :5173
```

Setup writes the new account names and their testnet keys to `app/.keyback/state.json`, which is git-ignored. The contract wasm is checked in under `contracts/out/`, so Rust and Docker are only needed to rebuild it.

### Do this, see that

| Do | See |
|---|---|
| Open `http://localhost:5173` | The landing page. "Open the live demo" goes to the console. |
| Top right, act as **Daniel** (landlord). Click **New lease**, then **Create lease**. | A new lease in "Awaiting deposit", with a $500 tUSD deposit. |
| Switch to **Amara** (tenant). Open the lease, click **Pay the deposit**. | $500 tUSD moves into the contract. The money bar shows it as "Held in contract". |
| As Amara, then Daniel, click **Sign the move-in report**. | The lease goes to "Active". The report hash is on-chain; the evidence tab shows the items. |
| As Amara, **Record the move-out report** with the default preset. | "Claim window open" with a live countdown. Demo windows are 60 seconds. |
| As Daniel, **Claim deductions**, pick "Window, repaint, sofa, cleaning ($450)", submit. | "Claim filed". The tenant now has a response window. |
| As Amara, **Dispute the claim**, **File dispute**. | Within a few seconds the worker assesses it: **$60 allowed of $450**. Each item has a rule and a written reason (window damage allowed under R4, walls and sofa refused as fair wear under R3, cooker cleaning refused under R6 because it was left as found). |
| Open the **Decision** tab, then **Verification**. | The hashes of the reports, the claim and the decision are re-checked against what is on-chain. |
| Let the appeal window run out. | The keeper settles the lease: $440 to the tenant, $60 to the landlord. Each side then sees it under "Available to withdraw" and clicks **Withdraw**. |
| Open **Landlord records** in the side nav. | Daniel's share of deposits returned and score, computed from on-chain settlements only. |
| Act as **Assessor** or **Arbiter** from the menu. | Their queue of assigned cases. The arbiter can issue a ruling on an appealed lease. |

If you leave a lease alone during the claim window, it settles in the tenant's favour on its own. That is the contract working, not a bug.

### Checks you can run

```bash
cd app && npm run typecheck && npm test   # rule engine + NEAR AI proof verification tests
cd app && npm run smoke                    # full flow on testnet against the running API, 21 checks
```

Contract tests (49 for Keyback, 3 for the token) run in Docker so you need no local Rust:

```bash
docker run --rm -u root -v "$PWD/contracts:/host" -w /host sourcescan/cargo-near:0.23.0-rust-1.99.1 cargo test
```

## How the assessment works

The assessor reads four documents: the signed move-in report, the move-out report, the tenant's counter report if there is one, and the claim. It applies eight published rules (`GET /v1/rules`, and `app/src/assessor/rules.ts`):

- R1 Evidence: no item in both reports, no deduction.
- R2 No change: same or better condition, nothing deducted.
- R3 Fair wear and tear: a one-step drop from normal living is not chargeable.
- R4 Damage or loss: chargeable up to the amount claimed.
- R5 Betterment: no charging for upgrades; items already worn at move-in are capped at half.
- R6 Cleaning: only if the item ended up worse than at move-in.
- R7 Totals: never above the claim, every item gets a reason.
- R8 Burden of proof: where the two move-out reports disagree, the tenant's version stands.

The decision document is hashed and the hash goes on-chain with the split. Only the lease's named assessor account can submit it.

There are two modes:

- **Rules mode (default).** A deterministic rule engine. No key needed, same input gives the same answer. The attestation slot holds an honest marker saying no TEE was used.
- **NEAR AI mode.** Set `NEARAI_API_KEY` in `app/.env`. The case goes to a privately hosted model on NEAR AI Cloud running in a TEE. The worker fetches the TEE attestation with a fresh nonce, then the TEE's signature over the request and response hashes, and verifies all of it (`verifyProof` in `app/src/assessor/nearai.ts`). The model's output is clamped by the same rules, so it cannot award more than the claim. The full proof bundle is stored and its hash goes on-chain.

## Privacy, honestly

- On-chain: account names, amounts, deadlines, state, and sha256 hashes of every document. No addresses, photos, notes or reasons.
- Off-chain: the documents themselves, in a content-addressed store on the API host (`app/.keyback/blobs`). A read re-hashes the file and refuses it if it does not match the on-chain hash, so the server cannot quietly edit evidence.
- In NEAR AI mode the dispute is read inside a TEE, and the proof shows which model ran where.
- Not done yet: documents are not encrypted at rest, and the store is one server. Encryption to the parties' keys and replicated storage are the next steps before real money.

## Demo limits

- `DEMO_SIGNER=1` lets the API sign as the five fictional people so you can click through without wallets. The route only exists when the flag is set, and the setup only creates testnet accounts. In production every transaction is signed by the person's own wallet and this server holds no keys.
- Deadlines are 60 seconds in the demo. In a real lease they would be days or weeks.
- tUSD is a test token with an open faucet.

## Layout

```
contracts/keyback   the deposit contract (Rust, near-sdk 5)
contracts/tusd      NEP-141 test stablecoin
contracts/out       built wasm + ABI
app/src/api         Fastify API, assessor + keeper worker
app/src/assessor    rule engine and NEAR AI TEE client
app/src/lib         contract client, evidence store, config
web/                React console and landing page (Cloudscape, purple theme)
```

API routes: `GET /v1/deployment`, `/v1/rules`, `/v1/leases`, `/v1/leases/:id`, `/v1/leases/:id/proof`, `/v1/accounts/:id`, `/v1/landlords`, `/v1/export.csv`, `/v1/documents/:hash`, `POST /v1/documents`, `/v1/documents/hash`, `/v1/demo/actions` (demo only).

## License

MIT. See [LICENSE](LICENSE).

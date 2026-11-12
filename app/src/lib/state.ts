// Local deployment state: which contracts and testnet accounts this checkout uses.
// Written by `npm run setup`, git-ignored, never committed (it holds testnet keys).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";
import type { Key } from "./near.js";

export type DeployState = {
  network: "testnet";
  createdAt: string;
  contractId: string;
  tokenId: string;
  ops: Key;
  admin: Key;
  assessor: Key;
  arbiter: Key;
  /** Fictional demo characters, by first name. */
  people: Record<string, Key & { role: "landlord" | "tenant" }>;
};

export const statePath = () => join(config.dataDir, "state.json");

export function hasState(): boolean {
  return existsSync(statePath());
}

export function loadState(): DeployState {
  if (!hasState()) throw new Error(`No deployment found at ${statePath()}. Run "npm run setup" first.`);
  return JSON.parse(readFileSync(statePath(), "utf8"));
}

export function saveState(s: DeployState): void {
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(statePath(), JSON.stringify(s, null, 2), { mode: 0o600 });
}

/** Resolves a character name ("amara") or full account id to its key. */
export function keyFor(s: DeployState, who: string): Key {
  if (s.people[who]) return s.people[who];
  const p = Object.values(s.people).find((k) => k.id === who);
  if (p) return p;
  for (const k of [s.assessor, s.arbiter, s.admin, s.ops]) if (k.id === who) return k;
  throw new Error(`No key for "${who}" in this deployment`);
}

/** Public view of the deployment: account ids only, no keys. */
export function publicState(s: DeployState) {
  return {
    network: s.network,
    contractId: s.contractId,
    tokenId: s.tokenId,
    assessor: s.assessor.id,
    arbiter: s.arbiter.id,
    people: Object.fromEntries(Object.entries(s.people).map(([n, k]) => [n, { id: k.id, role: k.role }])),
  };
}

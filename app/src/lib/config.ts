// All runtime configuration, read once from the environment and validated at startup.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const REPO_ROOT = resolve(APP_ROOT, "..");

function int(name: string, dflt: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer, got "${v}"`);
  return n;
}

function oneOf<T extends string>(name: string, allowed: readonly T[], dflt: T): T {
  const v = (process.env[name] ?? dflt) as T;
  if (!allowed.includes(v)) throw new Error(`${name} must be one of ${allowed.join(", ")}, got "${v}"`);
  return v;
}

export const config = {
  rpcUrl: process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com",
  explorer: process.env.NEAR_EXPLORER ?? "https://testnet.nearblocks.io",
  dataDir: process.env.RUDISHA_DATA ?? join(APP_ROOT, ".rudisha"),
  port: int("PORT", 8787),
  host: process.env.HOST ?? "127.0.0.1",
  /** auto = NEAR AI if NEARAI_API_KEY is set, otherwise the rule engine. */
  assessorMode: oneOf("ASSESSOR_MODE", ["auto", "mock", "nearai"] as const, "auto"),
  nearAiKey: process.env.NEARAI_API_KEY ?? "",
  nearAiBase: process.env.NEARAI_BASE_URL ?? "https://cloud-api.near.ai/v1",
  nearAiModel: process.env.NEARAI_MODEL ?? "deepseek-ai/DeepSeek-V4.1-Flash-1017",
  /** Lets the API sign as the demo characters. Never enable with real users. */
  demoSigner: process.env.DEMO_SIGNER === "1",
  pollMs: int("ASSESSOR_POLL_MS", 4000),
} as const;

export function assessorUsesNearAi(): boolean {
  if (config.assessorMode === "mock") return false;
  if (config.assessorMode === "nearai" && !config.nearAiKey) {
    throw new Error("ASSESSOR_MODE=nearai needs NEARAI_API_KEY");
  }
  return Boolean(config.nearAiKey);
}

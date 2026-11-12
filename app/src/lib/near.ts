// Thin, typed wrapper over near-api-js: one provider, account helpers, view/call.
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPairString, teraToGas } from "near-api-js";
import { config } from "./config.js";

const FALLBACK_RPC = process.env.NEAR_RPC_FALLBACK ?? "https://rpc.testnet.near.org";
/** Primary RPC with an automatic fallback: public endpoints drop requests now and then. */
export const provider = new FailoverRpcProvider([
  new JsonRpcProvider({ url: config.rpcUrl }),
  new JsonRpcProvider({ url: FALLBACK_RPC }),
]);

const TRANSIENT = /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|timeout|429|50[234]|Too Many Requests/i;

/**
 * Retries network failures only. Contract rejections are never retried.
 * Retrying a write is safe here because every Rudisha transition is guarded
 * by state (a settled lease cannot settle twice, an empty balance cannot be withdrawn).
 */
export async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      if (i >= tries || !TRANSIENT.test(msg) || /panicked/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
}

export type Key = { id: string; key: string };

export function account(k: Key): Account {
  return new Account(k.id, provider, k.key as KeyPairString);
}

export async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await withRetry(() => provider.callFunction({ contractId, method, args }))) as T;
}

export type CallOpts = { deposit?: bigint; tgas?: number };

/** Calls a change method and returns the method's decoded return value. */
export async function call<T = unknown>(
  signer: Account,
  contractId: string,
  methodName: string,
  args: Record<string, unknown>,
  opts: CallOpts = {},
): Promise<T> {
  return (await withRetry(() =>
    signer.callFunction({
      contractId,
      methodName,
      args,
      gas: teraToGas(String(opts.tgas ?? 100) as `${number}`),
      deposit: opts.deposit ?? 0n,
    }),
  )) as T;
}

export async function accountExists(id: string): Promise<boolean> {
  try {
    await provider.viewAccount({ accountId: id });
    return true;
  } catch {
    return false;
  }
}

export const ONE_NEAR = 10n ** 24n;
export const USD = 1_000_000n; // tUSD has 6 decimals

export function usd(units: string | bigint | number): string {
  const v = BigInt(units);
  const whole = v / USD;
  const cents = ((v % USD) / 10_000n).toString().padStart(2, "0");
  return `$${whole.toLocaleString("en-US")}.${cents}`;
}

export const toUnits = (dollars: number): bigint => BigInt(Math.round(dollars * 100)) * 10_000n;

// Thin, typed wrapper over near-api-js: one provider, account helpers, view/call.
import { Account, JsonRpcProvider, KeyPairString, teraToGas } from "near-api-js";
import { config } from "./config.js";

export const provider = new JsonRpcProvider({ url: config.rpcUrl });

export type Key = { id: string; key: string };

export function account(k: Key): Account {
  return new Account(k.id, provider, k.key as KeyPairString);
}

export async function view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await provider.callFunction({ contractId, method, args })) as T;
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
  return (await signer.callFunction({
    contractId,
    methodName,
    args,
    gas: teraToGas(String(opts.tgas ?? 100) as `${number}`),
    deposit: opts.deposit ?? 0n,
  })) as T;
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

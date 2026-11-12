// Content-addressed evidence store. Every document is saved under the sha256 of
// its canonical JSON, and the same hash goes on-chain. Reads re-hash the file,
// so a swapped photo list or edited report is detected, not trusted.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";
import { mirrorBlob } from "./mirror.js";

/** JSON with sorted keys and no undefined values: the same object always hashes the same. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  if (typeof v === "number" && !Number.isFinite(v)) throw new Error("non-finite number in document");
  return JSON.stringify(v);
}

export const sha256 = (s: string | Uint8Array): string => createHash("sha256").update(s).digest("hex");

export const hashOf = (doc: unknown): string => sha256(canonical(doc));

const HEX64 = /^[0-9a-f]{64}$/;
export const blobDir = () => join(config.dataDir, "blobs");
const dir = blobDir;

export function put(doc: unknown): string {
  const body = canonical(doc);
  const h = sha256(body);
  mkdirSync(dir(), { recursive: true });
  const f = join(dir(), `${h}.json`);
  if (!existsSync(f)) {
    // write-then-rename so a crash never leaves a half-written blob behind
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, body);
    renameSync(tmp, f);
  }
  mirrorBlob(h, body);
  return h;
}

export class TamperedError extends Error {}

export function get<T = unknown>(hash: string): T | null {
  if (!HEX64.test(hash)) return null;
  const f = join(dir(), `${hash}.json`);
  if (!existsSync(f)) return null;
  const body = readFileSync(f, "utf8");
  if (sha256(body) !== hash) throw new TamperedError(`document ${hash} does not match its hash`);
  return JSON.parse(body) as T;
}

export function mustGet<T = unknown>(hash: string | null | undefined, what: string): T {
  if (!hash) throw new Error(`${what}: no hash on-chain`);
  const d = get<T>(hash);
  if (!d) throw new Error(`${what}: document ${hash} not found in the evidence store`);
  return d;
}

// Optional durable copy of the evidence store in Postgres (Neon).
//
// Hosts with an ephemeral disk lose app/.keyback/blobs on every restart, which
// would orphan the hashes already on-chain. When DATABASE_URL is set, every new
// blob is also written to a `blobs` table, and on boot the table is copied back
// to disk. The local files stay the source for reads, so the store API is
// unchanged and reads still re-hash every document.
import { neon } from "@neondatabase/serverless";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const url = process.env.DATABASE_URL ?? "";
const sql = url ? neon(url) : null;
const pending = new Set<Promise<unknown>>();

export const mirrorEnabled = () => sql !== null;

/** Queue a copy of a blob. Callers that are about to put its hash on-chain await flushMirror() first. */
export function mirrorBlob(hash: string, body: string): void {
  if (!sql) return;
  const p = Promise.resolve(sql`insert into blobs (hash, body) values (${hash}, ${body}) on conflict (hash) do nothing`);
  pending.add(p);
  void p.finally(() => pending.delete(p)).catch(() => {});
}

/** Waits for queued copies. Throws if any failed, so a hash is never committed without its document. */
export async function flushMirror(): Promise<void> {
  if (!pending.size) return;
  await Promise.all([...pending]);
}

/** Creates the table if needed and restores every blob that is missing on disk. Returns how many it wrote. */
export async function restoreBlobs(dir: string): Promise<number> {
  if (!sql) return 0;
  await sql`create table if not exists blobs (hash text primary key, body text not null, created_at timestamptz not null default now())`;
  const rows = (await sql`select hash, body from blobs`) as { hash: string; body: string }[];
  mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const { hash, body } of rows) {
    const f = join(dir, `${hash}.json`);
    if (existsSync(f)) continue;
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, body);
    renameSync(tmp, f);
    n++;
  }
  return n;
}

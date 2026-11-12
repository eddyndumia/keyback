// Background worker:
//  - assessor: picks up disputed leases and submits a verdict before its deadline
//  - keeper: calls `finalize` on leases whose deadline has passed, so default
//    outcomes (no claim -> tenant paid in full, etc.) happen without anyone asking.
// It holds only the assessor key and a funded keeper key, never user keys.
import type { FastifyBaseLogger } from "fastify";
import { config } from "../lib/config.js";
import { Rudisha } from "../lib/rudisha.js";
import { DeployState, loadState } from "../lib/state.js";

type Log = Pick<FastifyBaseLogger, "info" | "warn" | "error">;

export function startWorker(state: DeployState, log: Log): () => void {
  const r = new Rudisha(state);
  const inFlight = new Set<number>();
  let stopped = false;

  const tick = async () => {
    const leases = await r.allLeases();
    const now = Date.now();
    for (const l of leases) {
      if (inFlight.has(l.id)) continue;
      const deadlineMs = Number(BigInt(l.deadline) / 1_000_000n);
      const passed = deadlineMs > 0 && now > deadlineMs + 2_000; // small margin for block time
      let job: (() => Promise<unknown>) | null = null;
      if (l.state === "Disputed" && !passed) job = () => r.assess(l.id);
      else if (passed && ["MoveOut", "Claimed", "Assessed"].includes(l.state)) job = () => r.finalize(state.ops, l.id);
      if (!job) continue;
      inFlight.add(l.id);
      const kind = l.state === "Disputed" ? "assess" : "finalize";
      job()
        .then(() => log.info({ lease: l.id, kind }, "worker acted"))
        .catch((e) => log.warn({ lease: l.id, kind, err: (e as Error).message }, "worker action failed; will retry"))
        .finally(() => inFlight.delete(l.id));
    }
  };

  const loop = async () => {
    while (!stopped) {
      try {
        await tick();
      } catch (e) {
        log.error({ err: (e as Error).message }, "worker tick failed");
      }
      await new Promise((res) => setTimeout(res, config.pollMs));
    }
  };
  void loop();
  log.info({ pollMs: config.pollMs }, "assessor + keeper worker started");
  return () => {
    stopped = true;
  };
}

if (process.argv[1] && /worker\.(ts|js)$/.test(process.argv[1])) {
  const log: Log = {
    info: (o: any, m?: string) => console.log(JSON.stringify({ level: "info", msg: m, ...o })),
    warn: (o: any, m?: string) => console.warn(JSON.stringify({ level: "warn", msg: m, ...o })),
    error: (o: any, m?: string) => console.error(JSON.stringify({ level: "error", msg: m, ...o })),
  } as Log;
  const stop = startWorker(loadState(), log);
  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });
}

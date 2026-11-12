// Domain types: the on-chain lease (mirrors contracts/rudisha) and the off-chain
// evidence documents whose hashes go on-chain.

export type LeaseState =
  | "Created"
  | "Funded"
  | "Active"
  | "MoveOut"
  | "Claimed"
  | "Disputed"
  | "Assessed"
  | "Appealed"
  | "Settled"
  | "Cancelled";

export type Lease = {
  id: number;
  landlord: string;
  tenant: string;
  deposit: string;
  label: string;
  lease_end: string;
  claim_window_secs: number;
  response_window_secs: number;
  appeal_window_secs: number;
  state: LeaseState;
  checkin_hash: string | null;
  checkin_by_landlord: boolean;
  checkin_by_tenant: boolean;
  checkout_hash: string | null;
  checkout_by: string | null;
  counter_checkout_hash: string | null;
  assessor: string;
  arbiter: string;
  claim: { amount: string; items_hash: string; filed_at: string } | null;
  dispute_reason_hash: string | null;
  assessment: {
    to_landlord: string;
    reason_hash: string;
    attestation_hash: string;
    confidence_bps: number;
    at: string;
  } | null;
  appeal: { by: string; reason_hash: string; at: string } | null;
  ruling: { to_landlord: string; reason_hash: string; by: string; at: string } | null;
  paid_to_tenant: string;
  paid_to_landlord: string;
  created_at: string;
  funded_at: string;
  active_at: string;
  moveout_at: string;
  settled_at: string;
  deadline: string;
};

export type ChainRecord = {
  landlord_leases: number;
  landlord_settled: number;
  full_returns: number;
  claims_filed: number;
  claims_accepted: number;
  disputes_faced: number;
  disputes_lost: number;
  deposits_held: string;
  returned_to_tenants: string;
  return_secs_total: number;
  tenant_leases: number;
  tenant_settled: number;
  disputes_raised: number;
  disputes_won: number;
  deducted_from_me: string;
};

export type ContractConfig = {
  admin: string;
  token: string;
  assessor: string;
  arbiter: string;
  lease_count: number;
};

// ---------- evidence documents ----------

/** Ordered best to worst. A one-step drop that stays above "damaged" is wear and tear. */
export const CONDITIONS = ["new", "good", "fair", "worn", "damaged", "missing"] as const;
export type Condition = (typeof CONDITIONS)[number];

export type ReportItem = {
  item: string;
  condition: Condition;
  notes?: string;
  /** sha256 of each photo file. The photos themselves stay with the parties. */
  photos?: string[];
};

export type Report = {
  kind: "checkin" | "checkout";
  lease_id: number;
  date: string; // YYYY-MM-DD
  rooms: { room: string; items: ReportItem[] }[];
  keys?: number;
  meter_kwh?: number;
};

export type ClaimItem = {
  room: string;
  item: string;
  amount: string; // tUSD units
  reason: string;
  photos?: string[];
};

export type ClaimDoc = { lease_id: number; items: ClaimItem[]; note?: string };

export type DisputeDoc = { lease_id: number; by: string; text: string; contested?: string[] };

export type AssessedItem = {
  room: string;
  item: string;
  claimed: string;
  allowed: string;
  rule: string;
  reason: string;
};

export type AssessmentDoc = {
  lease_id: number;
  engine: "rules-v1" | `nearai:${string}`;
  to_landlord: string;
  confidence_bps: number;
  items: AssessedItem[];
  summary: string;
};

export type RulingDoc = { lease_id: number; by: string; to_landlord: string; text: string };

// ---------- validation (used by the API before anything is stored) ----------

const isStr = (v: unknown, max = 500): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const isUnits = (v: unknown): v is string => typeof v === "string" && /^[0-9]{1,24}$/.test(v);
const isHashList = (v: unknown) =>
  v === undefined || (Array.isArray(v) && v.length <= 20 && v.every((h) => typeof h === "string" && /^[0-9a-f]{64}$/.test(h)));

export function validateReport(r: any): string[] {
  const e: string[] = [];
  if (r?.kind !== "checkin" && r?.kind !== "checkout") e.push("kind must be checkin or checkout");
  if (!Number.isInteger(r?.lease_id) || r.lease_id < 0) e.push("lease_id must be a non-negative integer");
  if (typeof r?.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) e.push("date must be YYYY-MM-DD");
  if (!Array.isArray(r?.rooms) || r.rooms.length === 0 || r.rooms.length > 30) e.push("rooms must have 1..30 entries");
  else
    r.rooms.forEach((room: any, i: number) => {
      if (!isStr(room?.room, 60)) e.push(`rooms[${i}].room is required`);
      if (!Array.isArray(room?.items) || room.items.length === 0 || room.items.length > 40)
        e.push(`rooms[${i}].items must have 1..40 entries`);
      else
        room.items.forEach((it: any, j: number) => {
          if (!isStr(it?.item, 60)) e.push(`rooms[${i}].items[${j}].item is required`);
          if (!CONDITIONS.includes(it?.condition)) e.push(`rooms[${i}].items[${j}].condition must be one of ${CONDITIONS.join("|")}`);
          if (it?.notes !== undefined && (typeof it.notes !== "string" || it.notes.length > 500))
            e.push(`rooms[${i}].items[${j}].notes too long`);
          if (!isHashList(it?.photos)) e.push(`rooms[${i}].items[${j}].photos must be sha256 hashes`);
        });
    });
  return e;
}

export function validateClaim(c: any): string[] {
  const e: string[] = [];
  if (!Number.isInteger(c?.lease_id) || c.lease_id < 0) e.push("lease_id must be a non-negative integer");
  if (!Array.isArray(c?.items) || c.items.length === 0 || c.items.length > 40) e.push("items must have 1..40 entries");
  else
    c.items.forEach((it: any, i: number) => {
      if (!isStr(it?.room, 60) || !isStr(it?.item, 60)) e.push(`items[${i}] needs room and item`);
      if (!isUnits(it?.amount) || BigInt(it.amount) === 0n) e.push(`items[${i}].amount must be positive tUSD units`);
      if (!isStr(it?.reason, 500)) e.push(`items[${i}].reason is required`);
      if (!isHashList(it?.photos)) e.push(`items[${i}].photos must be sha256 hashes`);
    });
  return e;
}

export function validateText(d: any, field = "text"): string[] {
  return isStr(d?.[field], 2000) ? [] : [`${field} is required (max 2000 chars)`];
}

export const claimTotal = (c: ClaimDoc): bigint => c.items.reduce((s, i) => s + BigInt(i.amount), 0n);

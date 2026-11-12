// The deposit rules every assessment applies, in plain words and as code.
// They follow what deposit-protection schemes (UK TDS/DPS, Australian bond
// boards) apply, and what Kenyan tenancy guidance expects: the landlord must
// prove each deduction with the move-in and move-out reports.

import {
  AssessedItem,
  AssessmentDoc,
  ClaimDoc,
  CONDITIONS,
  Condition,
  Report,
  ReportItem,
} from "../lib/domain.js";

export const RULES = [
  "R1 Evidence: a deduction needs the item in BOTH the signed move-in report and the move-out report. No record, no deduction.",
  "R2 No change: if the item is in the same or better condition at move-out, nothing can be deducted.",
  "R3 Fair wear and tear: a drop of one step (new->good, good->fair, fair->worn) from normal living is not chargeable.",
  "R4 Damage or loss: an item that became damaged or missing may be charged, up to the amount claimed.",
  "R5 Betterment: a landlord cannot charge for an upgrade. An item that was already worn at move-in is capped at half the claim.",
  "R6 Cleaning: cleaning is chargeable only if the move-out report shows the item worse than at move-in.",
  "R7 Totals: the award never exceeds the claim, and every item gets a written reason.",
  "R8 Burden of proof: if the landlord's and tenant's move-out reports disagree about an item, the landlord has not proved it, so the tenant's version is used.",
] as const;

const rank = (c: Condition) => CONDITIONS.indexOf(c);
const norm = (s: string) => s.trim().toLowerCase();

function find(report: Report, room: string, item: string): ReportItem | undefined {
  const r = report.rooms.find((x) => norm(x.room) === norm(room));
  return r?.items.find((x) => norm(x.item) === norm(item));
}

/**
 * Deterministic assessment used when no NEAR AI key is configured, and as a cross-check.
 * `counter` is the other party's move-out report, if one was added.
 */
export function assessWithRules(checkin: Report, checkout: Report, claim: ClaimDoc, counter: Report | null = null): AssessmentDoc {
  const items: AssessedItem[] = claim.items.map((ci) => {
    const before = find(checkin, ci.room, ci.item);
    const first = find(checkout, ci.room, ci.item);
    const second = counter ? find(counter, ci.room, ci.item) : undefined;
    // R8: where the two move-out reports disagree, use the better condition (tenant's favour).
    const conflict = Boolean(first && second && first.condition !== second.condition);
    const after = first && second ? (rank(second.condition) < rank(first.condition) ? second : first) : (first ?? second);
    const note = conflict
      ? ` The two move-out reports disagree ("${first!.condition}" vs "${second!.condition}"); the landlord carries the burden of proof (R8).`
      : "";
    const claimed = BigInt(ci.amount);
    const out = (allowed: bigint, rule: string, reason: string): AssessedItem => ({
      room: ci.room,
      item: ci.item,
      claimed: claimed.toString(),
      allowed: allowed.toString(),
      rule: conflict && allowed < claimed ? "R8" : rule,
      reason: reason + note,
    });

    if (!before || !after) {
      return out(0n, "R1", `"${ci.item}" in ${ci.room} is missing from the ${!before ? "move-in" : "move-out"} report, so the claim has no evidence.`);
    }
    const drop = rank(after.condition) - rank(before.condition);
    if (drop <= 0) {
      return out(0n, /clean/i.test(ci.reason) ? "R6" : "R2", `Recorded as "${before.condition}" at move-in and "${after.condition}" at move-out: no deterioration.`);
    }
    const becameDamaged = rank(after.condition) >= rank("damaged");
    if (!becameDamaged && drop === 1) {
      return out(0n, "R3", `"${before.condition}" to "${after.condition}" is one step of normal wear and tear.`);
    }
    if (!becameDamaged) {
      // two or more steps without outright damage: heavier than normal use, half the claim
      return out(claimed / 2n, "R3", `"${before.condition}" to "${after.condition}" is more than normal wear but not damage: half the claim.`);
    }
    if (rank(before.condition) >= rank("worn")) {
      return out(claimed / 2n, "R5", `Already "${before.condition}" at move-in, now "${after.condition}": capped at half to avoid charging for an upgrade.`);
    }
    return out(claimed, "R4", `"${before.condition}" at move-in, "${after.condition}" at move-out: damage the tenant is responsible for.`);
  });

  const to_landlord = items.reduce((s, i) => s + BigInt(i.allowed), 0n);
  const clear = items.filter((i) => i.rule === "R1" || i.rule === "R2" || i.rule === "R4").length;
  const confidence_bps = Math.round(6000 + (4000 * clear) / Math.max(items.length, 1));
  const allowedCount = items.filter((i) => i.allowed !== "0").length;
  return {
    lease_id: claim.lease_id,
    engine: "rules-v1",
    to_landlord: to_landlord.toString(),
    confidence_bps,
    items,
    summary: `${allowedCount} of ${items.length} claimed items allowed. Award ${to_landlord} of ${claim.items
      .reduce((s, i) => s + BigInt(i.amount), 0n)
      .toString()} units claimed.`,
  };
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { assessWithRules } from "./rules.js";
import type { ClaimDoc, Report } from "../lib/domain.js";

const checkin: Report = {
  kind: "checkin",
  lease_id: 7,
  date: "2025-01-01",
  rooms: [
    { room: "Living room", items: [
      { item: "Walls", condition: "good" },
      { item: "Sofa", condition: "worn" },
      { item: "TV stand", condition: "good" },
    ] },
    { room: "Kitchen", items: [{ item: "Oven", condition: "good" }] },
  ],
};
const checkout: Report = {
  ...checkin,
  kind: "checkout",
  date: "2026-01-01",
  rooms: [
    { room: "Living room", items: [
      { item: "Walls", condition: "fair" },
      { item: "Sofa", condition: "damaged" },
      { item: "TV stand", condition: "missing" },
    ] },
    { room: "Kitchen", items: [{ item: "Oven", condition: "good" }] },
  ],
};
const claim = (items: [string, string, number, string?][]): ClaimDoc => ({
  lease_id: 7,
  items: items.map(([room, item, amount, reason]) => ({ room, item, amount: String(amount), reason: reason ?? "damage" })),
});

test("one-step wear is not chargeable (R3)", () => {
  const a = assessWithRules(checkin, checkout, claim([["Living room", "Walls", 100]]));
  assert.equal(a.to_landlord, "0");
  assert.equal(a.items[0].rule, "R3");
});

test("missing item is chargeable in full (R4)", () => {
  const a = assessWithRules(checkin, checkout, claim([["Living room", "TV stand", 80]]));
  assert.equal(a.to_landlord, "80");
  assert.equal(a.items[0].rule, "R4");
});

test("already-worn item is capped at half (R5)", () => {
  const a = assessWithRules(checkin, checkout, claim([["Living room", "Sofa", 200]]));
  assert.equal(a.to_landlord, "100");
  assert.equal(a.items[0].rule, "R5");
});

test("unchanged item cannot be charged, cleaning cites R6", () => {
  const a = assessWithRules(checkin, checkout, claim([["Kitchen", "Oven", 50, "deep cleaning"]]));
  assert.equal(a.to_landlord, "0");
  assert.equal(a.items[0].rule, "R6");
});

test("item missing from a report has no evidence (R1)", () => {
  const a = assessWithRules(checkin, checkout, claim([["Bedroom", "Bed", 300]]));
  assert.equal(a.to_landlord, "0");
  assert.equal(a.items[0].rule, "R1");
});

test("matching is case and space insensitive, and totals add up", () => {
  const a = assessWithRules(checkin, checkout, claim([
    [" living ROOM ", "tv stand", 80],
    ["Living room", "Walls", 100],
  ]));
  assert.equal(a.to_landlord, "80");
  assert.ok(a.confidence_bps >= 6000 && a.confidence_bps <= 10000);
});

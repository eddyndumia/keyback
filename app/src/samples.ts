// Fictional sample evidence for the demo. Names, flats and photos are invented.
import type { ClaimDoc, Condition, Report } from "./lib/domain.js";
import { sha256 } from "./lib/store.js";
import { toUnits } from "./lib/near.js";

const photo = (s: string) => sha256(`fictional-photo:${s}`);

type Row = [room: string, item: string, condition: Condition, notes?: string];

function report(kind: Report["kind"], leaseId: number, date: string, rows: Row[]): Report {
  const rooms = new Map<string, Report["rooms"][number]>();
  for (const [room, item, condition, notes] of rows) {
    if (!rooms.has(room)) rooms.set(room, { room, items: [] });
    rooms.get(room)!.items.push({ item, condition, notes, photos: [photo(`${leaseId}:${kind}:${room}:${item}`)] });
  }
  return { kind, lease_id: leaseId, date, rooms: [...rooms.values()], keys: 2 };
}

const FLAT: Row[] = [
  ["Living room", "Walls", "good", "Painted white, no marks"],
  ["Living room", "Sofa", "good", "3-seater, grey fabric"],
  ["Living room", "TV stand", "good"],
  ["Kitchen", "Cooker", "good", "4-burner gas cooker"],
  ["Kitchen", "Sink", "good"],
  ["Bedroom", "Wardrobe", "good", "Sliding doors work"],
  ["Bedroom", "Window", "good", "Glass intact"],
  ["Bathroom", "Shower", "good"],
];

export const checkin = (leaseId: number) => report("checkin", leaseId, "2025-11-01", FLAT);

/** Move-out where the tenant left the flat as found, apart from normal living. */
export const checkoutClean = (leaseId: number) =>
  report("checkout", leaseId, "2026-11-01", FLAT.map(([r, i, c, n]) =>
    i === "Walls" ? [r, i, "fair", "Light scuffs near the sofa"] : [r, i, c, n],
  ));

/** Move-out with one real piece of damage and some normal wear. */
export const checkoutDamaged = (leaseId: number) =>
  report("checkout", leaseId, "2026-11-01", FLAT.map(([r, i, c, n]): Row => {
    if (i === "Window") return [r, i, "damaged", "Cracked pane, bottom left"];
    if (i === "Walls") return [r, i, "fair", "Scuffs and two nail holes"];
    if (i === "Sofa") return [r, i, "fair", "Fabric slightly faded"];
    return [r, i, c, n];
  }));

/** A landlord's doctored move-out report: normal wear written up as damage. */
export const checkoutDoctored = (leaseId: number) =>
  report("checkout", leaseId, "2026-11-01", FLAT.map(([r, i, c, n]): Row => {
    if (i === "Window") return [r, i, "damaged", "Cracked pane, bottom left"];
    if (i === "Walls") return [r, i, "damaged", "Walls badly marked, needs full repaint"];
    if (i === "Sofa") return [r, i, "damaged", "Sofa ruined"];
    return [r, i, c, n];
  }));

/** A fair claim: only the cracked window. */
export const fairClaim = (leaseId: number): ClaimDoc => ({
  lease_id: leaseId,
  items: [{ room: "Bedroom", item: "Window", amount: toUnits(60).toString(), reason: "Replace cracked glass pane" }],
});

/** An inflated claim: the window, plus repainting, a new sofa and cleaning. */
export const inflatedClaim = (leaseId: number): ClaimDoc => ({
  lease_id: leaseId,
  items: [
    { room: "Bedroom", item: "Window", amount: toUnits(60).toString(), reason: "Replace cracked glass pane" },
    { room: "Living room", item: "Walls", amount: toUnits(150).toString(), reason: "Full repaint of living room" },
    { room: "Living room", item: "Sofa", amount: toUnits(200).toString(), reason: "Replace faded sofa" },
    { room: "Kitchen", item: "Cooker", amount: toUnits(40).toString(), reason: "Deep cleaning of cooker" },
  ],
  note: "Flat needs refreshing for the next tenant.",
});

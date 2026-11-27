import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TrackerView } from "@/components/tracker/public-view";
import { buildPublicModel } from "@/lib/tracker/model";
import { generatePulseToken } from "@/lib/pulse/token-hash";
import { readTrackerSale, trackerSnapshotFromSale, type TrackerSnapshot } from "@/lib/tracker/snapshot";
import { snapshotIsFresh, trackerStages, TRACKER_SNAPSHOT_TTL_MS, type TrackerInstall } from "@/lib/tracker/stages";

const fixture = JSON.parse(readFileSync(new URL("../cin7/fixtures/so-00490-anon.json", import.meta.url), "utf8")) as unknown;

function snap(patch: Partial<TrackerSnapshot> = {}): TrackerSnapshot {
  return {
    orderNumber: "SO-10001",
    saleId: "11111111-1111-4111-8111-111111111111",
    customerName: "Example Gym",
    status: "ORDERED",
    orderStatus: "AUTHORISED",
    pickingStatus: "NOT PICKED",
    packingStatus: "NOT PACKED",
    shippingStatus: "NOT SHIPPED",
    fulfilmentStatus: "NOT FULFILLED",
    shipBy: null,
    requiredBy: null,
    carrier: null,
    trackingNumbers: [],
    items: [{ name: "Example bench", quantity: 2 }],
    ...patch,
  };
}

function current(snapshot: TrackerSnapshot, photos = 0, install: TrackerInstall | null = null) {
  return trackerStages(snapshot, photos, install).find((stage) => stage.state === "current")?.id ?? null;
}

function keysOf(value: unknown, found: string[] = []) {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, found));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      found.push(key);
      keysOf(child, found);
    }
  }
  return found;
}

describe("tracker tokens", () => {
  it("stores a hash of at least 32 random bytes", () => {
    const issued = generatePulseToken();
    expect(Buffer.from(issued.token, "base64url")).toHaveLength(32);
    expect(issued.hashHex).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("tracker snapshots", () => {
  it("drops prices, notes, emails, and staff names from the anonymised sale", () => {
    const snapshot = trackerSnapshotFromSale(fixture);
    expect(snapshot?.orderNumber).toBe("SO-00490");
    expect(snapshot?.customerName).toBe("Example Customer");
    expect(snapshot?.items.some((item) => item.name.includes("SkiErg"))).toBe(true);
    expect(snapshot?.items.some((item) => item.name === "Delivery Charge")).toBe(false);
    const keys = keysOf(snapshot);
    expect(keys.some((key) => /price|tax|total|email|phone|note|rep|memo|comment/i.test(key))).toBe(false);
    const encoded = JSON.stringify(snapshot);
    expect(encoded).not.toContain("£");
    expect(encoded).not.toContain("65779");
    expect(encoded).not.toContain("679.17");
    expect(encoded).not.toContain("Nik Elphick");
    expect(encoded).not.toContain("jane.example@example.com");
    expect(encoded).not.toContain("01603");
  });

  it("reads a sale with sale and saleList only", async () => {
    const calls: string[] = [];
    const sale = {
      ID: "11111111-1111-4111-8111-111111111111",
      Customer: "Example Gym",
      Status: "ORDERED",
      Order: { SaleOrderNumber: "SO-10001", Status: "AUTHORISED", Lines: [{ Name: "Bench", Quantity: 1, Price: 88.5, Total: 88.5 }] },
    };
    const snapshot = await readTrackerSale("SO-10001", async (path, query) => {
      calls.push(path);
      if (path === "saleList") return { SaleList: [{ ID: sale.ID, OrderNumber: "SO-10001" }], Total: 1 };
      if (path === "sale") {
        expect(query.ID).toBe(sale.ID);
        return sale;
      }
      throw new Error(`unexpected ${path}`);
    });
    expect(calls).toEqual(["saleList", "sale"]);
    expect(snapshot?.items).toEqual([{ name: "Bench", quantity: 1 }]);
    expect(JSON.stringify(snapshot)).not.toContain("88.5");
  });
});

describe("tracker stages", () => {
  it("keeps a snapshot for 15 minutes", () => {
    const now = Date.parse("2026-11-27T12:00:00.000Z");
    expect(TRACKER_SNAPSHOT_TTL_MS).toBe(15 * 60 * 1000);
    expect(snapshotIsFresh(new Date(now - 14 * 60 * 1000).toISOString(), now)).toBe(true);
    expect(snapshotIsFresh(new Date(now - TRACKER_SNAPSHOT_TTL_MS).toISOString(), now)).toBe(false);
    expect(snapshotIsFresh(null, now)).toBe(false);
  });

  it("maps the anonymised SO-00490 sale to order confirmed", () => {
    const snapshot = trackerSnapshotFromSale(fixture);
    expect(snapshot).not.toBeNull();
    expect(current(snapshot as TrackerSnapshot)).toBe("confirmed");
    expect(buildPublicModel({ snapshot: snapshot as TrackerSnapshot, install: null, photos: [] }).expectedLabel).toBeNull();
  });

  it("walks each fulfilment state", () => {
    expect(current(snap({ status: "DRAFT", orderStatus: "DRAFT" }))).toBeNull();
    expect(current(snap({ status: "ESTIMATED", orderStatus: null }))).toBeNull();
    expect(current(snap({ status: "VOIDED", orderStatus: "VOIDED" }))).toBeNull();
    expect(current(snap({ status: "ORDERING", orderStatus: "DRAFT", pickingStatus: "NOT AVAILABLE", packingStatus: "NOT AVAILABLE", shippingStatus: "NOT AVAILABLE", fulfilmentStatus: "NOT AVAILABLE" }))).toBe("confirmed");
    expect(current(snap())).toBe("preparing");
    expect(current(snap({ status: "BACKORDERED" }))).toBe("preparing");
    expect(current(snap(), 2)).toBe("checked");
    expect(current(snap({ shippingStatus: "PARTIALLY SHIPPED", fulfilmentStatus: "PARTIALLY FULFILLED" }))).toBe("dispatched");
    const shipped = trackerStages(snap({ shippingStatus: "SHIPPED", fulfilmentStatus: "FULFILLED", carrier: "DED", trackingNumbers: ["TRK100"] }), 0, null);
    expect(shipped.find((stage) => stage.id === "dispatched")).toMatchObject({ state: "current", detail: "TRK100" });
    expect(shipped.find((stage) => stage.id === "checked")?.state).toBe("skipped");
    expect(shipped.find((stage) => stage.id === "dispatched")?.detail).not.toContain("DED");
    const named = trackerStages(snap({ shippingStatus: "SHIPPED", carrier: "FEDI", trackingNumbers: ["TRK100"] }), 1, null);
    expect(named.find((stage) => stage.id === "dispatched")?.detail).toBe("FedEx · TRK100");
    expect(current(snap({ shippingStatus: "NOT SHIPPED", trackingNumbers: ["TRK100"] }))).toBe("dispatched");
    expect(current(snap(), 0, { status: "cancelled", startOn: "2026-12-03" })).toBe("preparing");
    expect(current(snap({ shippingStatus: "SHIPPED" }), 1, { status: "booked", startOn: "2026-12-03" })).toBe("install_booked");
    expect(current(snap({ shippingStatus: "SHIPPED" }), 1, { status: "completed", startOn: "2026-12-03" })).toBe("installed");
  });

  it("uses the install date, then the ship-by date", () => {
    const booked = buildPublicModel({
      snapshot: snap({ shipBy: "2026-12-18T00:00:00" }),
      install: { status: "scheduled", startOn: "2026-12-03" },
      photos: [],
    });
    expect(booked.expectedLabel).toBe("3 Dec 2026");
    const ship = buildPublicModel({
      snapshot: snap({ shipBy: null, requiredBy: "2026-12-18T00:00:00" }),
      install: { status: "cancelled", startOn: "2026-12-01" },
      photos: [],
    });
    expect(ship.expectedLabel).toBe("18 Dec 2026");
  });
});

describe("tracker page", () => {
  it("renders no prices from the anonymised sale", () => {
    const snapshot = trackerSnapshotFromSale(fixture);
    const model = buildPublicModel({
      snapshot: snapshot as TrackerSnapshot,
      install: { status: "booked", startOn: "2026-12-03" },
      photos: [{ id: "photo-1", caption: "Packed", src: "/api/track/media/token/photo-1" }],
    });
    const html = renderToStaticMarkup(createElement(TrackerView, { model }));
    expect(html).toContain("SO-00490");
    expect(html).toContain("Example Customer");
    expect(html).toContain("Concept2 SkiErg");
    expect(html).toContain("3 Dec 2026");
    expect(html).toContain("Order confirmed");
    expect(html).toContain("Install booked");
    expect(html).not.toContain("£");
    expect(html).not.toContain("65779");
    expect(html).not.toContain("679.17");
    expect(html).not.toContain("Nik Elphick");
    expect(html).not.toContain("jane.example");
    expect(html).not.toContain("DED");
    expect(html).not.toContain("Delivery Charge");
  });
});

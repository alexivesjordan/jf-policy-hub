import { describe, expect, it } from "vitest";
import { pageDone, parseAvailability, parseProducts, parsePurchase, parseSale, parseSaleList, parseSuppliers } from "@/lib/supply/cin7-map";
import { runSupplySync, type SyncState } from "@/lib/supply/sync";

describe("Cin7 supply payloads", () => {
  it("reads products, suppliers, stock, a sale, and a purchase", () => {
    expect(parseProducts({ Products: [{ SKU: "JF-1", Name: "Example bar" }, { Name: "No sku" }] })).toEqual([{ sku: "JF-1", label: "Example bar" }]);
    expect(parseSuppliers({ SupplierList: [{ ID: "sup-1", Name: "Example Parts", Currency: "gbp", Status: "Active" }] })).toEqual([
      { cin7SupplierId: "sup-1", name: "Example Parts", currency: "GBP", active: true },
    ]);
    expect(parseAvailability({
      ProductAvailabilityList: [
        { SKU: "JF-1", Location: "Main", OnHand: 4, Allocated: 1, Available: 3, OnOrder: 2 },
        { SKU: "JF-1", Location: "Quarantine", OnHand: 1, Allocated: 0, Available: 1, OnOrder: 0 },
      ],
    })).toHaveLength(2);
    const sale = parseSale({
      ID: "sale-1",
      Status: "COMPLETED",
      SaleOrderDate: "2024-06-15T00:00:00",
      Order: { Lines: [{ SKU: "JF-1", Quantity: 2 }, { SKU: "JF-1", Quantity: 1 }] },
    });
    expect(sale).toMatchObject({ saleId: "sale-1", counts: true, orderedOn: "2024-06-15" });
    expect(sale?.lines).toEqual([{ sku: "JF-1", qty: 3 }]);
    expect(parseSale({ ID: "sale-2", Status: "DRAFT", SaleOrderDate: "2024-06-01", Order: { Lines: [] } })?.counts).toBe(false);
    expect(parsePurchase({
      Status: "COMPLETED",
      OrderNumber: "PO-9",
      SupplierID: "sup-1",
      OrderDate: "2024-05-01T00:00:00",
      Order: { Lines: [{ SKU: "JF-1", Quantity: 5 }] },
    })?.lines[0]).toMatchObject({ poRef: "PO-9", qty: 5, receivedOn: "2024-05-01" });
    expect(parsePurchase({ Status: "VOIDED", OrderNumber: "PO-8" })?.voided).toBe("PO-8");
    expect(parseSaleList({ SaleList: [{ SaleID: "sale-1" }] })).toEqual(["sale-1"]);
    expect(pageDone({ Total: 100, Products: new Array(100) }, 1, 100)).toBe(true);
    expect(pageDone({ Products: new Array(100) }, 1, 100)).toBe(false);
  });
});

const idle: SyncState = {
  phase: "idle",
  productsPage: 1,
  suppliersPage: 1,
  availabilityPage: 1,
  salesPage: 1,
  purchasesPage: 1,
  forecastOffset: 0,
  forecastRunId: null,
  salesSince: null,
  purchasesSince: null,
  runStartedAt: null,
  stockLocation: null,
  lookbackMonths: 36,
  lastSyncFinishedAt: null,
  lastSyncCalls: 0,
  lastSyncError: null,
};

describe("supply sync budget", () => {
  it("stops at the call budget and resumes on the same phase", async () => {
    const paths: string[] = [];
    const saved: SyncState[] = [];
    const get = async (path: string) => {
      paths.push(path);
      if (path === "product") return { Total: 1, Products: [{ SKU: "JF-1", Name: "Example bar" }] };
      if (path === "supplier") return { Total: 1, SupplierList: [{ ID: "sup-1", Name: "Example Parts", Currency: "GBP", Status: "Active" }] };
      if (path === "ref/productavailability") return { Total: 1, ProductAvailabilityList: [{ SKU: "JF-1", Location: "Main", OnHand: 0, Allocated: 0, Available: 0, OnOrder: 0 }] };
      if (path === "saleList") return { Total: 1, SaleList: [{ SaleID: "sale-1" }] };
      if (path === "sale") return { ID: "sale-1", Status: "COMPLETED", SaleOrderDate: "2024-06-15T00:00:00", Order: { Lines: [{ SKU: "JF-1", Quantity: 2 }] } };
      return { Total: 0 };
    };
    const save = {
      products: async () => undefined,
      suppliers: async () => undefined,
      stock: async () => undefined,
      foldStock: async () => undefined,
      sales: async () => undefined,
      purchases: async () => undefined,
      forecastInputs: async () => ({ settings: { serviceLevel: 0.95, reviewDays: 14, defaultLeadTimeDays: 14, forecastMonths: 6, smaWindow: 6, crostonAlpha: 0.2 }, rows: [] }),
      saveRun: async () => "run-1",
      saveState: async (state: SyncState) => {
        saved.push(state);
      },
    };
    const first = await runSupplySync({ state: idle, get, save, budget: 3, now: "2026-11-27T02:30:00.000Z" });
    expect(first.calls).toBe(3);
    expect(first.done).toBe(false);
    expect(first.phase).toBe("sales");
    expect(paths).toEqual(["product", "supplier", "ref/productavailability"]);
    const second = await runSupplySync({ state: saved[0]!, get, save, budget: 10, now: "2026-11-27T02:40:00.000Z" });
    expect(second.calls).toBe(3);
    expect(paths.slice(3)).toEqual(["saleList", "sale", "purchaseList"]);
    expect(second.done).toBe(true);
    expect(second.phase).toBe("idle");
    expect(saved.at(-1)?.salesSince).toBe("2026-11-27T02:30:00.000Z");
  });
});

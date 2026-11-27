/** Fixture answers for Pulse Supply screens. Names and quantities are fake. */

const overview = {
  lastSync: "2026-11-27T02:30:00.000Z",
  zeroStock: 2,
  belowReorder: 3,
  overstock: 1,
  alerts: [
    { sku: "JF-BAR-1", reason: "Zero stock. Below reorder point", onHand: 0, available: 0, onOrder: 0, zeroStock: true, belowReorder: true },
    { sku: "JF-DB-20", reason: "Below reorder point", onHand: 4, available: 2, onOrder: 0, zeroStock: false, belowReorder: true },
  ],
};

const reorder = {
  runId: "run-1",
  canEdit: true,
  groups: [
    {
      supplierId: "sup-1",
      supplierName: "Example Parts",
      currency: "GBP",
      rows: [
        { id: "sug-1", sku: "JF-BAR-1", available: 0, onOrder: 0, reorderPoint: 12, suggestedQty: 24, reason: "Zero stock" },
        { id: "sug-2", sku: "JF-DB-20", available: 2, onOrder: 0, reorderPoint: 8, suggestedQty: 12, reason: "Below reorder point" },
      ],
    },
  ],
};

const suppliers = {
  canEdit: true,
  rows: [
    { id: "sup-1", name: "Example Parts", leadTimeDays: 21, moq: 4, orderMultiple: 2, currency: "GBP", active: true, source: "cin7" },
    { id: "sup-2", name: "North Steel", leadTimeDays: 45, moq: 10, orderMultiple: 5, currency: "GBP", active: true, source: "orderwise" },
  ],
};

export function fixtureSupplyRpc(fn: string, args?: Record<string, unknown>) {
  if (fn === "supply_overview") return { handled: true, data: overview };
  if (fn === "supply_reorder") return { handled: true, data: reorder };
  if (fn === "supply_skus") {
    const search = String(args?.p_search ?? "").toLowerCase();
    const rows = [
      { sku: "JF-BAR-1", label: "Example bar", supplier: "Example Parts", exclude: false, onHand: 0, available: 0 },
      { sku: "JF-DB-20", label: "Example dumbbell", supplier: "Example Parts", exclude: false, onHand: 4, available: 2 },
      { sku: "JF-PLATE-10", label: "Example plate", supplier: "North Steel", exclude: false, onHand: 40, available: 40 },
    ].filter((row) => !search || row.sku.toLowerCase().includes(search) || row.label.toLowerCase().includes(search));
    return { handled: true, data: rows };
  }
  if (fn === "supply_sku") {
    return {
      handled: true,
      data: {
        sku: String(args?.p_sku ?? "JF-BAR-1"),
        label: "Example bar",
        supplierId: "sup-1",
        supplierName: "Example Parts",
        leadTimeDays: 21,
        leadTimeSource: "manual",
        moq: 4,
        orderMultiple: 2,
        safetyDays: 7,
        exclude: false,
        onHand: 0,
        available: 0,
        onOrder: 0,
        capturedAt: "2026-11-27T02:30:00.000Z",
        demand: [
          { month: "2024-01-01", qty: 8, source: "orderwise", orderCount: 2 },
          { month: "2024-02-01", qty: 6, source: "orderwise", orderCount: 1 },
          { month: "2026-10-01", qty: 4, source: "cin7", orderCount: 1 },
          { month: "2026-11-01", qty: 5, source: "cin7", orderCount: 2 },
        ],
        forecast: [
          { month: "2026-12-01", qty: 5, method: "sma" },
          { month: "2027-01-01", qty: 5, method: "sma" },
        ],
      },
    };
  }
  if (fn === "supply_suppliers") return { handled: true, data: suppliers };
  if (fn === "supply_settings") {
    return {
      handled: true,
      data: {
        serviceLevel: 0.95,
        reviewDays: 14,
        defaultLeadTimeDays: 14,
        forecastMonths: 6,
        zeroStockAlert: true,
        stockLocation: null,
        smaWindow: 6,
        crostonAlpha: 0.2,
        initialLookbackMonths: 36,
        canAdmin: true,
        lastSync: "2026-11-27T02:30:00.000Z",
        lastSyncError: null,
        phase: "idle",
      },
    };
  }
  if (fn === "supply_mappings") {
    return {
      handled: true,
      data: {
        canEdit: true,
        canAdmin: true,
        mappings: [{ id: "map-1", name: "Orderwise sales", kind: "sales_lines", columns: { date: "Date", sku: "Code", qty: "Qty" }, dateFormat: "dd/mm/yyyy", delimiter: "," }],
        batches: [{ id: "batch-1", mappingName: "Orderwise sales", kind: "sales_lines", filePath: "history.csv", status: "loaded", rowsRead: 50, rowsLoaded: 12, rowsUnmatched: 3, createdAt: "2026-11-26T16:00:00.000Z" }],
      },
    };
  }
  if (fn === "supply_unmatched") return { handled: true, data: [{ code: "OLD-1", qty: 4 }, { code: "OLD-2", qty: 1 }] };
  if (fn === "supply_assert_admin") return { handled: true, data: null };
  if (fn.startsWith("supply_")) return { handled: true, data: null };
  return { handled: false, data: null };
}

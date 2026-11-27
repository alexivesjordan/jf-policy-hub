import "server-only";

import { createCin7Throttle } from "@/lib/cin7/throttle";
import { cin7Get } from "@/lib/cin7/transport";
import { isFixtureMode } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { runSupplySync, SUPPLY_CALL_BUDGET, type ForecastRow, type ForecastSettings, type SyncReport, type SyncState } from "@/lib/supply/sync";

function text(value: unknown) {
  return typeof value === "string" ? value : null;
}

function num(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stateFrom(value: unknown): SyncState {
  const row = value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const phase = text(row.phase);
  const allowed = ["idle", "products", "suppliers", "availability", "sales", "purchases", "forecast"] as const;
  return {
    phase: allowed.includes(phase as SyncState["phase"]) ? (phase as SyncState["phase"]) : "idle",
    productsPage: num(row.productsPage, 1),
    suppliersPage: num(row.suppliersPage, 1),
    availabilityPage: num(row.availabilityPage, 1),
    salesPage: num(row.salesPage, 1),
    purchasesPage: num(row.purchasesPage, 1),
    forecastOffset: num(row.forecastOffset, 0),
    forecastRunId: text(row.forecastRunId),
    salesSince: text(row.salesSince),
    purchasesSince: text(row.purchasesSince),
    runStartedAt: text(row.runStartedAt),
    stockLocation: text(row.stockLocation),
    lookbackMonths: num(row.lookbackMonths, 36),
    lastSyncFinishedAt: text(row.lastSyncFinishedAt),
    lastSyncCalls: num(row.lastSyncCalls, 0),
    lastSyncError: text(row.lastSyncError),
  };
}

function asRecord(value: unknown) {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export async function runSupplySyncJob(): Promise<SyncReport & { error?: string }> {
  if (isFixtureMode()) return { calls: 0, phase: "idle", done: false, products: 0, suppliers: 0, stock: 0, sales: 0, purchases: 0, error: "Cin7 is not connected." };
  const accountId = process.env.CIN7_ACCOUNT_ID?.trim() ?? "";
  const applicationKey = process.env.CIN7_APPLICATION_KEY?.trim() ?? "";
  if (!accountId || !applicationKey) {
    return { calls: 0, phase: "idle", done: false, products: 0, suppliers: 0, stock: 0, sales: 0, purchases: 0, error: "Cin7 is not connected." };
  }
  const admin = createAdminClient();
  if (!admin) return { calls: 0, phase: "idle", done: false, products: 0, suppliers: 0, stock: 0, sales: 0, purchases: 0, error: "The service role key is not set." };

  const current = await admin.rpc("supply_sync_state");
  if (current.error || !current.data) return { calls: 0, phase: "idle", done: false, products: 0, suppliers: 0, stock: 0, sales: 0, purchases: 0, error: "Could not read the sync cursor." };
  const throttle = createCin7Throttle({ limit: 45 });

  try {
    const report = await runSupplySync({
      state: stateFrom(current.data),
      budget: SUPPLY_CALL_BUDGET,
      get: (path, query) => cin7Get({ accountId, applicationKey, path, query, throttle }),
      save: {
        async products(rows) {
          const { error } = await admin.rpc("supply_sync_products", { p_rows: rows });
          if (error) throw new Error("Could not save products.");
        },
        async suppliers(rows) {
          const { error } = await admin.rpc("supply_sync_suppliers", { p_rows: rows.map((row) => ({ cin7_supplier_id: row.cin7SupplierId, name: row.name, currency: row.currency, active: row.active })) });
          if (error) throw new Error("Could not save suppliers.");
        },
        async stock(rows) {
          const { error } = await admin.rpc("supply_sync_stock", { p_rows: rows.map((row) => ({ sku: row.sku, location: row.location, on_hand: row.onHand, allocated: row.allocated, available: row.available, on_order: row.onOrder })) });
          if (error) throw new Error("Could not save stock.");
        },
        async foldStock(capturedAt) {
          const { error } = await admin.rpc("supply_sync_stock_fold", { p_captured: capturedAt });
          if (error) throw new Error("Could not store the stock snapshot.");
        },
        async sales(rows) {
          const { error } = await admin.rpc("supply_sync_sales", { p_rows: rows.map((row) => ({ saleId: row.saleId, status: row.status, orderedOn: row.orderedOn, lines: row.lines })) });
          if (error) throw new Error("Could not save sales.");
        },
        async purchases(body) {
          const { error } = await admin.rpc("supply_sync_purchases", { p_body: { voided: body.voided, lines: body.lines.map((line) => ({ po_ref: line.poRef, supplier_key: line.supplierKey, sku: line.sku, qty: line.qty, ordered_on: line.orderedOn, received_on: line.receivedOn })) } });
          if (error) throw new Error("Could not save purchases.");
        },
        async forecastInputs(offset, limit) {
          const { data, error } = await admin.rpc("supply_forecast_inputs", { p_offset: offset, p_limit: limit });
          if (error || !data) throw new Error("Could not read forecast inputs.");
          const root = asRecord(data);
          const settings = asRecord(root.settings) as ForecastSettings;
          const rows = Array.isArray(root.rows) ? (root.rows as ForecastRow[]) : [];
          return {
            settings: {
              serviceLevel: num(settings.serviceLevel, 0.95),
              reviewDays: num(settings.reviewDays, 14),
              defaultLeadTimeDays: num(settings.defaultLeadTimeDays, 14),
              forecastMonths: num(settings.forecastMonths, 6),
              smaWindow: num(settings.smaWindow, 6),
              crostonAlpha: num(settings.crostonAlpha, 0.2),
            },
            rows: rows.map((row) => ({
              ...row,
              safetyDays: row.safetyDays == null ? null : num(row.safetyDays, 0),
              demand: Array.isArray(row.demand) ? row.demand : [],
            })),
          };
        },
        async saveRun(body) {
          const { data, error } = await admin.rpc("supply_save_run", { p_body: body });
          if (error || typeof data !== "string") throw new Error("Could not store the forecast.");
          return data;
        },
        async saveState(state) {
          const { error } = await admin.rpc("supply_sync_state_save", {
            p_body: {
              phase: state.phase,
              productsPage: state.productsPage,
              suppliersPage: state.suppliersPage,
              availabilityPage: state.availabilityPage,
              salesPage: state.salesPage,
              purchasesPage: state.purchasesPage,
              forecastOffset: state.forecastOffset,
              forecastRunId: state.forecastRunId,
              salesSince: state.salesSince,
              purchasesSince: state.purchasesSince,
              runStartedAt: state.runStartedAt,
              lastSyncFinishedAt: state.lastSyncFinishedAt,
              lastSyncCalls: state.lastSyncCalls,
              lastSyncError: state.lastSyncError,
            },
          });
          if (error) throw new Error("Could not save the sync cursor.");
        },
      },
    });
    console.info(`supply sync calls=${report.calls} phase=${report.phase} done=${report.done} products=${report.products} suppliers=${report.suppliers} stock=${report.stock} sales=${report.sales} purchases=${report.purchases}`);
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "Cin7 sync failed.";
    await admin.rpc("supply_sync_state_save", { p_body: { lastSyncError: message } });
    console.info(`supply sync failed calls=${SUPPLY_CALL_BUDGET} message=${message}`);
    return { calls: 0, phase: "idle", done: false, products: 0, suppliers: 0, stock: 0, sales: 0, purchases: 0, error: message };
  }
}

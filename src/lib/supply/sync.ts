import type { DemandPoint, Plan } from "@/lib/supply/plan";
import { mergeDemand, planSku } from "@/lib/supply/plan";
import {
  pageDone,
  parseAvailability,
  parseProducts,
  parsePurchase,
  parsePurchaseList,
  parseSale,
  parseSaleList,
  parseSuppliers,
} from "@/lib/supply/cin7-map";

export const SUPPLY_CALL_BUDGET = 40;
export const SUPPLY_PAGE_LIMIT = 100;

export type SyncPhase = "idle" | "products" | "suppliers" | "availability" | "sales" | "purchases" | "forecast";

export type SyncState = {
  phase: SyncPhase;
  productsPage: number;
  suppliersPage: number;
  availabilityPage: number;
  salesPage: number;
  purchasesPage: number;
  forecastOffset: number;
  forecastRunId: string | null;
  salesSince: string | null;
  purchasesSince: string | null;
  runStartedAt: string | null;
  stockLocation: string | null;
  lookbackMonths: number;
  lastSyncFinishedAt: string | null;
  lastSyncCalls: number;
  lastSyncError: string | null;
};

export type ForecastRow = {
  sku: string;
  supplierId: string | null;
  leadTimeDays: number;
  moq: number;
  orderMultiple: number;
  safetyDays: number | null;
  onHand: number;
  available: number;
  onOrder: number;
  demand: DemandPoint[];
};

export type ForecastSettings = {
  serviceLevel: number;
  reviewDays: number;
  defaultLeadTimeDays: number;
  forecastMonths: number;
  smaWindow: number;
  crostonAlpha: number;
};

type Saver = {
  products(rows: { sku: string; label: string }[]): Promise<void>;
  suppliers(rows: { cin7SupplierId: string; name: string; currency: string; active: boolean }[]): Promise<void>;
  stock(rows: { sku: string; location: string; onHand: number; allocated: number; available: number; onOrder: number }[]): Promise<void>;
  foldStock(capturedAt: string): Promise<void>;
  sales(rows: { saleId: string; status: string; orderedOn: string | null; lines: { sku: string; qty: number }[] }[]): Promise<void>;
  purchases(body: { lines: { poRef: string; supplierKey: string | null; sku: string; qty: number; orderedOn: string | null; receivedOn: string | null }[]; voided: string[] }): Promise<void>;
  forecastInputs(offset: number, limit: number): Promise<{ settings: ForecastSettings; rows: ForecastRow[] }>;
  saveRun(body: { runId: string | null; done: boolean; settings: ForecastSettings; forecasts: unknown[]; suggestions: unknown[] }): Promise<string>;
  saveState(state: SyncState): Promise<void>;
};

export type SyncReport = {
  calls: number;
  phase: SyncPhase;
  done: boolean;
  products: number;
  suppliers: number;
  stock: number;
  sales: number;
  purchases: number;
};

function cin7Stamp(value: string) {
  return value.replace(/\.\d{3}Z$/, "").replace(/Z$/, "");
}

function monthsBefore(iso: string, months: number) {
  const date = new Date(iso);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString();
}

function fresh(state: SyncState, now: string): SyncState {
  if (state.phase !== "idle") return { ...state, lastSyncError: null };
  return {
    ...state,
    phase: "products",
    productsPage: 1,
    suppliersPage: 1,
    availabilityPage: 1,
    salesPage: 1,
    purchasesPage: 1,
    forecastOffset: 0,
    forecastRunId: null,
    runStartedAt: now,
    lastSyncError: null,
  };
}

export function planRows(settings: ForecastSettings, rows: ForecastRow[]) {
  const forecasts: { sku: string; method: Plan["method"]; month: string; qty: number }[] = [];
  const suggestions: Record<string, unknown>[] = [];
  for (const row of rows) {
    const merged = mergeDemand(row.demand);
    const start = merged.months[0];
    const startMonth = start ? Number(start.slice(5, 7)) - 1 : 0;
    const plan = planSku({
      monthly: merged.qty,
      startMonth,
      leadTimeDays: row.leadTimeDays,
      reviewDays: settings.reviewDays,
      safetyDays: row.safetyDays,
      serviceLevel: settings.serviceLevel,
      moq: row.moq,
      orderMultiple: row.orderMultiple,
      available: row.available,
      onOrder: row.onOrder,
      onHand: row.onHand,
      smaWindow: settings.smaWindow,
      crostonAlpha: settings.crostonAlpha,
      forecastMonths: settings.forecastMonths,
    });
    const anchor = start ? new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1 + merged.qty.length, 1)) : new Date();
    plan.forecasts.forEach((qty, index) => {
      const month = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + index, 1));
      const y = month.getUTCFullYear();
      const m = String(month.getUTCMonth() + 1).padStart(2, "0");
      forecasts.push({ sku: row.sku, method: plan.method, month: `${y}-${m}-01`, qty: Number(qty.toFixed(3)) });
    });
    suggestions.push({
      supplier_id: row.supplierId,
      sku: row.sku,
      on_hand: row.onHand,
      available: row.available,
      on_order: row.onOrder,
      reorder_point: Number(plan.reorderPoint.toFixed(3)),
      suggested_qty: plan.suggestedQty,
      reason: plan.reason,
      zero_stock: plan.zeroStock,
      below_reorder: plan.belowReorder,
      overstock: plan.overstock,
    });
  }
  return { forecasts, suggestions };
}

export async function runSupplySync(options: {
  state: SyncState;
  get: (path: string, query: Record<string, string>) => Promise<unknown>;
  save: Saver;
  budget?: number;
  now?: string;
}): Promise<SyncReport> {
  const budget = options.budget ?? SUPPLY_CALL_BUDGET;
  const now = options.now ?? new Date().toISOString();
  let state = fresh(options.state, now);
  let calls = 0;
  const report: SyncReport = { calls: 0, phase: state.phase, done: false, products: 0, suppliers: 0, stock: 0, sales: 0, purchases: 0 };

  async function pull(path: string, query: Record<string, string>) {
    if (calls >= budget) return null;
    calls += 1;
    report.calls = calls;
    return options.get(path, query);
  }

  while (state.phase !== "idle") {
    if (state.phase !== "forecast" && calls >= budget) break;

    if (state.phase === "products") {
      const body = await pull("product", { Page: String(state.productsPage), Limit: String(SUPPLY_PAGE_LIMIT), IncludeDeprecated: "true" });
      if (!body) break;
      const parsed = parseProducts(body);
      if (parsed.length > 0) await options.save.products(parsed);
      report.products += parsed.length;
      if (pageDone(body, state.productsPage, SUPPLY_PAGE_LIMIT)) {
        state = { ...state, phase: "suppliers", suppliersPage: 1 };
      } else {
        state = { ...state, productsPage: state.productsPage + 1 };
      }
      continue;
    }

    if (state.phase === "suppliers") {
      const body = await pull("supplier", { Page: String(state.suppliersPage), Limit: String(SUPPLY_PAGE_LIMIT) });
      if (!body) break;
      const parsed = parseSuppliers(body);
      if (parsed.length > 0) await options.save.suppliers(parsed);
      report.suppliers += parsed.length;
      if (pageDone(body, state.suppliersPage, SUPPLY_PAGE_LIMIT)) {
        state = { ...state, phase: "availability", availabilityPage: 1 };
      } else {
        state = { ...state, suppliersPage: state.suppliersPage + 1 };
      }
      continue;
    }

    if (state.phase === "availability") {
      const query: Record<string, string> = { Page: String(state.availabilityPage), Limit: String(SUPPLY_PAGE_LIMIT) };
      if (state.stockLocation) query.Location = state.stockLocation;
      const body = await pull("ref/productavailability", query);
      if (!body) break;
      const parsed = parseAvailability(body);
      if (parsed.length > 0) await options.save.stock(parsed);
      report.stock += parsed.length;
      if (pageDone(body, state.availabilityPage, SUPPLY_PAGE_LIMIT)) {
        await options.save.foldStock(now);
        state = { ...state, phase: "sales", salesPage: 1 };
      } else {
        state = { ...state, availabilityPage: state.availabilityPage + 1 };
      }
      continue;
    }

    if (state.phase === "sales") {
      const salesSince = state.salesSince ?? monthsBefore(state.runStartedAt ?? now, state.lookbackMonths);
      state = { ...state, salesSince };
      const body = await pull("saleList", {
        UpdatedSince: cin7Stamp(salesSince),
        Page: String(state.salesPage),
        Limit: String(SUPPLY_PAGE_LIMIT),
      });
      if (!body) break;
      const ids = parseSaleList(body);
      const sales: { saleId: string; status: string; orderedOn: string | null; lines: { sku: string; qty: number }[] }[] = [];
      let stopped = false;
      for (const id of ids) {
        if (calls >= budget) {
          stopped = true;
          break;
        }
        const saleBody = await pull("sale", { ID: id });
        if (!saleBody) {
          stopped = true;
          break;
        }
        const sale = parseSale(saleBody);
        if (sale) sales.push({ saleId: sale.saleId, status: sale.counts ? sale.status : "VOIDED", orderedOn: sale.orderedOn, lines: sale.lines });
      }
      if (sales.length > 0) await options.save.sales(sales);
      report.sales += sales.length;
      if (!stopped && pageDone(body, state.salesPage, SUPPLY_PAGE_LIMIT)) {
        state = { ...state, phase: "purchases", purchasesPage: 1 };
      } else if (!stopped) {
        state = { ...state, salesPage: state.salesPage + 1 };
      }
      if (stopped) break;
      continue;
    }

    if (state.phase === "purchases") {
      const purchasesSince = state.purchasesSince ?? monthsBefore(state.runStartedAt ?? now, state.lookbackMonths);
      state = { ...state, purchasesSince };
      const body = await pull("purchaseList", {
        UpdatedSince: cin7Stamp(purchasesSince),
        Page: String(state.purchasesPage),
        Limit: String(SUPPLY_PAGE_LIMIT),
      });
      if (!body) break;
      const ids = parsePurchaseList(body);
      const lines: { poRef: string; supplierKey: string | null; sku: string; qty: number; orderedOn: string | null; receivedOn: string | null }[] = [];
      const voided: string[] = [];
      let stopped = false;
      for (const id of ids) {
        if (calls >= budget) {
          stopped = true;
          break;
        }
        const purchaseBody = await pull("purchase", { ID: id });
        if (!purchaseBody) {
          stopped = true;
          break;
        }
        const purchase = parsePurchase(purchaseBody);
        if (!purchase) continue;
        if (purchase.voided) voided.push(purchase.voided);
        lines.push(...purchase.lines);
      }
      if (lines.length > 0 || voided.length > 0) await options.save.purchases({ lines, voided });
      report.purchases += lines.length;
      if (!stopped && pageDone(body, state.purchasesPage, SUPPLY_PAGE_LIMIT)) {
        state = { ...state, phase: "forecast", forecastOffset: state.forecastRunId ? state.forecastOffset : 0 };
      } else if (!stopped) {
        state = { ...state, purchasesPage: state.purchasesPage + 1 };
      }
      if (stopped) break;
      continue;
    }

    const page = await options.save.forecastInputs(state.forecastOffset, 50);
    if (page.rows.length === 0) {
      if (state.forecastRunId) {
        await options.save.saveRun({ runId: state.forecastRunId, done: true, settings: page.settings, forecasts: [], suggestions: [] });
      }
      state = {
        ...state,
        phase: "idle",
        forecastRunId: null,
        forecastOffset: 0,
        salesSince: state.runStartedAt,
        purchasesSince: state.runStartedAt,
        lastSyncFinishedAt: now,
        lastSyncCalls: calls,
        lastSyncError: null,
      };
      report.done = true;
      break;
    }
    const planned = planRows(page.settings, page.rows);
    const runId = await options.save.saveRun({
      runId: state.forecastRunId,
      done: false,
      settings: page.settings,
      forecasts: planned.forecasts,
      suggestions: planned.suggestions,
    });
    state = { ...state, forecastRunId: runId, forecastOffset: state.forecastOffset + page.rows.length };
  }

  report.phase = state.phase;
  report.calls = calls;
  state = { ...state, lastSyncCalls: (options.state.lastSyncCalls ?? 0) + calls };
  await options.save.saveState(state);
  return report;
}

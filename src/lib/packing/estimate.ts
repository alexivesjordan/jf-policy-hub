import { packPieces } from "./pack";
import { round1, tenths, usableInterior } from "./space";
import type {
  DemandLine,
  EstimateFlag,
  EstimateResult,
  InvoiceDimensionRow,
  LoadSpace,
  PackageSpec,
  PackPiece,
  PalletPlan,
  ParcelGroup,
  Unplaced,
} from "./types";

const MAX_PALLET_PIECES = 200;
const MAX_LINE_QTY = 500;
const MAX_INVOICE_ROWS = 30;

export function estimateShipment(input: {
  lines: DemandLine[];
  packages: PackageSpec[];
  space: LoadSpace;
  maxHeightCm: number;
  maxGrossKg: number;
  maxParcelWeightKg: number;
  maxParcelLengthCm: number;
}): EstimateResult {
  const spaceError = settingsError(input);
  if (spaceError) return blocked(spaceError);
  const interior = usableInterior(input.space, { maxHeightCm: input.maxHeightCm, maxGrossKg: input.maxGrossKg });
  if (interior.heightCm < 1 || interior.maxGoodsKg <= 0) return blocked("Max height or weight is below the pallet.");

  const missing: EstimateFlag[] = [];
  const parcels: ParcelGroup[] = [];
  const palletPieces: PackPiece[] = [];
  const lines = mergeLines(input.lines);
  const bySku = new Map<string, PackageSpec[]>();
  for (const pack of input.packages) {
    const list = bySku.get(pack.sku) ?? [];
    list.push(pack);
    bySku.set(pack.sku, list);
  }

  for (const line of lines) {
    const name = line.name.trim() || line.sku || "Item";
    const sku = line.sku.trim();
    if (!sku) {
      missing.push({ sku: "", name, message: `${name} has no SKU.` });
      continue;
    }
    if (!Number.isFinite(line.qty) || line.qty <= 0) continue;
    if (!Number.isInteger(line.qty)) {
      missing.push({ sku, name, message: `${sku} quantity is not a whole number.` });
      continue;
    }
    if (line.qty > MAX_LINE_QTY) {
      missing.push({ sku, name, message: `${sku} quantity is too large.` });
      continue;
    }
    const packs = (bySku.get(sku) ?? []).slice().sort((a, b) => a.packageNo - b.packageNo);
    if (!packs.length) {
      missing.push({ sku, name, message: `${sku} has no packaging.` });
      continue;
    }
    for (const pack of packs) {
      if (!complete(pack)) {
        missing.push({ sku, name, message: `${sku} box ${pack.packageNo} has no dimensions.` });
        continue;
      }
      if (shipsAsParcel(pack, input.maxParcelWeightKg, input.maxParcelLengthCm)) {
        const existing = parcels.find((group) => sameParcel(group, pack));
        if (existing) existing.count += line.qty;
        else parcels.push({
          sku,
          name: pack.name || name,
          packageNo: pack.packageNo,
          lengthCm: pack.lengthCm!,
          widthCm: pack.widthCm!,
          heightCm: pack.heightCm!,
          weightKg: round1(pack.weightKg!),
          count: line.qty,
        });
        continue;
      }
      for (let copy = 1; copy <= line.qty; copy += 1) {
        palletPieces.push(pieceFrom(pack, name, copy));
      }
    }
  }

  parcels.sort((a, b) => a.sku.localeCompare(b.sku) || a.packageNo - b.packageNo);
  if (palletPieces.length > MAX_PALLET_PIECES) {
    return finish({
      parcels,
      pallets: [],
      missing: [...missing, { sku: "", name: "", message: "Too many pallet packages to estimate." }],
      unfit: [],
    });
  }

  const packed = packPieces(palletPieces, interior, MAX_INVOICE_ROWS);
  const pallets: PalletPlan[] = packed.bins.map((bin, index) => ({
    index: index + 1,
    code: input.space.code,
    lengthCm: input.space.lengthCm,
    widthCm: input.space.widthCm,
    goodsHeightCm: bin.goodsHeightCm,
    totalHeightCm: bin.goodsHeightCm + input.space.deckCm,
    grossKg: round1((tenths(bin.goodsKg) + tenths(input.space.tareKg)) / 10),
    placements: bin.placements,
  }));

  return finish({ parcels, pallets, missing, unfit: groupedUnfit(packed.unplaced) });
}

function mergeLines(lines: DemandLine[]) {
  const merged: DemandLine[] = [];
  for (const line of lines) {
    const sku = line.sku.trim();
    const existing = sku ? merged.find((row) => row.sku === sku) : undefined;
    if (existing) existing.qty += line.qty;
    else merged.push({ sku, name: line.name, qty: line.qty });
  }
  return merged;
}

function settingsError(input: {
  space: LoadSpace;
  maxHeightCm: number;
  maxGrossKg: number;
  maxParcelWeightKg: number;
  maxParcelLengthCm: number;
}) {
  if (!Number.isInteger(input.maxHeightCm) || input.maxHeightCm < 50 || input.maxHeightCm > 300) return "Max height is invalid.";
  if (!(input.maxGrossKg > 0) || input.maxGrossKg > 2000 || !oneDecimal(input.maxGrossKg)) return "Max gross weight is invalid.";
  if (!(input.maxParcelWeightKg > 0) || input.maxParcelWeightKg > 100 || !oneDecimal(input.maxParcelWeightKg)) return "Parcel weight is invalid.";
  if (!Number.isInteger(input.maxParcelLengthCm) || input.maxParcelLengthCm < 10 || input.maxParcelLengthCm > 300) return "Parcel length is invalid.";
  if (input.maxHeightCm <= input.space.deckCm) return "Max height is below the pallet deck.";
  if (input.maxGrossKg <= input.space.tareKg) return "Max gross weight is below the pallet weight.";
  return "";
}

function complete(pack: PackageSpec): boolean {
  return pack.lengthCm != null && pack.widthCm != null && pack.heightCm != null && pack.weightKg != null
    && pack.lengthCm >= 1 && pack.widthCm >= 1 && pack.heightCm >= 1 && pack.weightKg > 0;
}

function shipsAsParcel(pack: PackageSpec, maxWeightKg: number, maxLengthCm: number) {
  const longest = Math.max(pack.lengthCm!, pack.widthCm!, pack.heightCm!);
  return !pack.palletOnly && tenths(pack.weightKg!) <= tenths(maxWeightKg) && longest <= maxLengthCm;
}

function sameParcel(group: ParcelGroup, pack: PackageSpec) {
  return group.sku === pack.sku
    && group.packageNo === pack.packageNo
    && group.lengthCm === pack.lengthCm
    && group.widthCm === pack.widthCm
    && group.heightCm === pack.heightCm
    && tenths(group.weightKg) === tenths(pack.weightKg!);
}

function pieceFrom(pack: PackageSpec, fallbackName: string, copy: number): PackPiece {
  return {
    id: `${pack.sku}#${pack.packageNo}#${copy}`,
    sku: pack.sku,
    name: pack.name || fallbackName,
    stackKey: `${pack.sku}#${pack.packageNo}`,
    lengthCm: pack.lengthCm!,
    widthCm: pack.widthCm!,
    heightCm: pack.heightCm!,
    weightKg: round1(pack.weightKg!),
    stackable: pack.stackable,
    maxStack: pack.maxStack,
    canBeOnSide: pack.canBeOnSide,
  };
}

function groupedUnfit(unplaced: Unplaced[]): EstimateFlag[] {
  const groups = new Map<string, { sku: string; name: string; reason: Unplaced["reason"]; packageNo: string; count: number }>();
  for (const item of unplaced) {
    const packageNo = item.piece.stackKey.split("#")[1] ?? "1";
    const key = `${item.piece.sku}#${packageNo}#${item.reason}`;
    const existing = groups.get(key);
    if (existing) existing.count += 1;
    else groups.set(key, { sku: item.piece.sku, name: item.piece.name, reason: item.reason, packageNo, count: 1 });
  }
  return [...groups.values()].map((group) => {
    const label = `${group.sku} box ${group.packageNo}`;
    const count = group.count > 1 ? ` (${group.count})` : "";
    const detail = group.reason === "too-heavy"
      ? "is heavier than the pallet limit"
      : group.reason === "limit"
        ? "needs more pallets than this estimate allows"
        : "does not fit a pallet";
    return { sku: group.sku, name: group.name, message: `${label} ${detail}${count}.` };
  });
}

function finish(input: {
  parcels: ParcelGroup[];
  pallets: PalletPlan[];
  missing: EstimateFlag[];
  unfit: EstimateFlag[];
}): EstimateResult {
  const parcelCount = input.parcels.reduce((sum, group) => sum + group.count, 0);
  const rowCount = parcelCount + input.pallets.length;
  const invoiceRows = invoiceRowsFrom(input.parcels, input.pallets);
  const blockReason = input.missing[0]?.message
    || input.unfit[0]?.message
    || (rowCount > MAX_INVOICE_ROWS ? "Commercial invoices hold 30 rows." : "")
    || (rowCount < 1 ? "Nothing to ship." : "")
    || invoiceProblem(invoiceRows);
  return {
    parcelCount,
    palletCount: input.pallets.length,
    parcels: input.parcels,
    pallets: input.pallets,
    missing: input.missing,
    unfit: input.unfit,
    invoiceRows: blockReason ? [] : invoiceRows,
    rowCount,
    readyForInvoice: blockReason === "",
    blockReason,
  };
}

function invoiceRowsFrom(parcels: ParcelGroup[], pallets: PalletPlan[]): InvoiceDimensionRow[] {
  const rows: InvoiceDimensionRow[] = [];
  for (const group of parcels) {
    for (let copy = 0; copy < group.count; copy += 1) {
      rows.push({
        kind: "parcel",
        lengthCm: group.lengthCm,
        widthCm: group.widthCm,
        depthCm: group.heightCm,
        weightKg: group.weightKg,
      });
    }
  }
  for (const pallet of pallets) {
    rows.push({
      kind: "pallet",
      lengthCm: pallet.lengthCm,
      widthCm: pallet.widthCm,
      depthCm: pallet.totalHeightCm,
      weightKg: pallet.grossKg,
    });
  }
  return rows;
}

function invoiceProblem(rows: InvoiceDimensionRow[]) {
  for (const row of rows) {
    if (![row.lengthCm, row.widthCm, row.depthCm].every((value) => Number.isInteger(value) && value >= 1 && value <= 1000)) {
      return "A dimension is outside the invoice limits.";
    }
    if (!(row.weightKg > 0) || row.weightKg > 2000 || !oneDecimal(row.weightKg)) {
      return "A weight is outside the invoice limits.";
    }
  }
  return "";
}

function oneDecimal(value: number) {
  return Number.isFinite(value) && Math.abs(value * 10 - Math.round(value * 10)) < 1e-6;
}

function blocked(message: string): EstimateResult {
  return finish({ parcels: [], pallets: [], missing: [{ sku: "", name: "", message }], unfit: [] });
}

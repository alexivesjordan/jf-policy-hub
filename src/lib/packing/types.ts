/** Shared by the pallet estimator and a later container or vehicle planner. */

export type PackPiece = {
  id: string;
  sku: string;
  name: string;
  stackKey: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  stackable: boolean;
  /** Maximum of this package in one column, including the bottom one. Null means no extra cap. */
  maxStack: number | null;
  canBeOnSide: boolean;
};

export type UsableSpace = {
  lengthCm: number;
  widthCm: number;
  /** Clear height above the deck. For a container this is the internal height. */
  heightCm: number;
  maxGoodsKg: number;
};

/**
 * One row of logistics.load_spaces.
 * Pallet height includes the deck, and pallet max weight includes tare.
 * A container or vehicle stores internal height and cargo weight, with deck and tare at 0.
 */
export type LoadSpace = {
  code: string;
  kind: "pallet" | "container" | "vehicle";
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  maxWeightKg: number;
  deckCm: number;
  tareKg: number;
};

export type Placement = {
  id: string;
  sku: string;
  name: string;
  stackKey: string;
  x: number;
  y: number;
  z: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  stackable: boolean;
};

export type PackedBin = {
  placements: Placement[];
  goodsKg: number;
  goodsHeightCm: number;
};

export type UnplacedReason = "too-large" | "too-heavy" | "limit";

export type Unplaced = {
  piece: PackPiece;
  reason: UnplacedReason;
};

export type DemandLine = {
  sku: string;
  name: string;
  qty: number;
};

export type PackageSpec = {
  sku: string;
  name: string;
  packageNo: number;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  weightKg: number | null;
  stackable: boolean;
  maxStack: number | null;
  canBeOnSide: boolean;
  palletOnly: boolean;
};

export type ParcelGroup = {
  sku: string;
  name: string;
  packageNo: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  count: number;
};

export type PalletPlan = {
  index: number;
  code: string;
  lengthCm: number;
  widthCm: number;
  goodsHeightCm: number;
  totalHeightCm: number;
  grossKg: number;
  placements: Placement[];
};

export type InvoiceDimensionRow = {
  kind: "parcel" | "pallet";
  lengthCm: number;
  widthCm: number;
  depthCm: number;
  weightKg: number;
};

export type EstimateFlag = {
  sku: string;
  name: string;
  message: string;
};

export type EstimateResult = {
  parcelCount: number;
  palletCount: number;
  parcels: ParcelGroup[];
  pallets: PalletPlan[];
  missing: EstimateFlag[];
  unfit: EstimateFlag[];
  invoiceRows: InvoiceDimensionRow[];
  rowCount: number;
  readyForInvoice: boolean;
  blockReason: string;
};

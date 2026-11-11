type HiddenQuoteLine = {
  sku: string;
  description: string;
  qty: number;
  category: string;
  lineTotal: number | null;
  unitWeightKg: number | null;
  productId: string;
  uom?: string | null;
  tileLength?: number | null;
  tileWidth?: number | null;
  dimensionUnit?: string | null;
  tilesPerPack?: number | null;
};

/** Every line is posted for pricing. Nothing about the product or quantity is shown. */
export function QuoteLineFields({ lines }: { lines: HiddenQuoteLine[] }) {
  return (
    <div className="hidden" aria-hidden="true">
      {lines.map((line, index) => (
        <span key={`${line.sku}-${index}`}>
          <input type="hidden" name="lineSku" value={line.sku} />
          <input type="hidden" name="lineProductId" value={line.productId} />
          <input type="hidden" name="lineWeight" value={line.unitWeightKg ?? ""} />
          <input type="hidden" name="lineUom" value={line.uom ?? ""} />
          <input type="hidden" name="lineTileLength" value={line.tileLength ?? ""} />
          <input type="hidden" name="lineTileWidth" value={line.tileWidth ?? ""} />
          <input type="hidden" name="lineDimensionUnit" value={line.dimensionUnit ?? ""} />
          <input type="hidden" name="lineTilesPerPack" value={line.tilesPerPack ?? ""} />
          <input type="hidden" name="lineDescription" value={line.description} />
          <input type="hidden" name="lineQty" value={line.qty} />
          <input type="hidden" name="lineCategory" value={line.category} />
          <input type="hidden" name="lineTotal" value={line.lineTotal ?? ""} />
        </span>
      ))}
    </div>
  );
}

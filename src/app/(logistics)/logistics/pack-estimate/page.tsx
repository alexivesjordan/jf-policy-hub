import { PackEstimator } from "@/components/logistics/pack-estimator";
import { loadPackingCatalogue } from "@/features/logistics/packing/queries";

export const metadata = { title: "Pack estimate" };

export default async function PackEstimatePage() {
  let catalogue: Awaited<ReturnType<typeof loadPackingCatalogue>> | null = null;
  let error = "";
  try {
    catalogue = await loadPackingCatalogue();
  } catch (err) {
    error = err instanceof Error ? err.message : "Could not load pallet sizes.";
  }
  const defaults = catalogue?.defaults ?? {
    palletCode: catalogue?.pallets[0]?.code ?? "",
    maxHeightCm: 180,
    maxWeightKg: 1000,
    maxParcelWeightKg: 30,
    maxParcelLengthCm: 120,
  };
  return (
    <div className="space-y-4">
      <h1 className="font-display text-4xl">Pack estimate</h1>
      {error ? <p role="alert" className="font-semibold">{error}</p> : null}
      {!error && catalogue && catalogue.pallets.length === 0 ? <p>Pallet sizes are not available.</p> : null}
      {catalogue && catalogue.pallets.length > 0 ? <PackEstimator pallets={catalogue.pallets} defaults={defaults} /> : null}
    </div>
  );
}

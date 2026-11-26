export type SkuPackageRow = {
  id: number;
  sku: string;
  product_name: string;
  cin7_category: string | null;
  package_no: number;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  gross_weight_kg: number | null;
  stackable: boolean;
  max_stack: number | null;
  can_be_on_side: boolean;
  ships_on_pallet_only: boolean;
};

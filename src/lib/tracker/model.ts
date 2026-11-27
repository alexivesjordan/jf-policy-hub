import { expectedDate, quantityLabel, trackerStages, type TrackerInstall } from "@/lib/tracker/stages";
import type { TrackerSnapshot } from "@/lib/tracker/snapshot";

export type PublicPhoto = {
  id: string;
  caption: string | null;
  src: string;
};

export type PublicTrackerModel = {
  orderNumber: string;
  customerName: string;
  expectedOn: string | null;
  expectedLabel: string | null;
  stages: ReturnType<typeof trackerStages>;
  items: { name: string; quantity: string }[];
  photos: PublicPhoto[];
};

export function buildPublicModel(input: {
  snapshot: TrackerSnapshot;
  install: TrackerInstall | null;
  photos: PublicPhoto[];
}): PublicTrackerModel {
  const expected = expectedDate(input.snapshot, input.install);
  const visible = input.photos.filter((photo) => photo.src);
  return {
    orderNumber: input.snapshot.orderNumber,
    customerName: input.snapshot.customerName.trim(),
    expectedOn: expected?.iso ?? null,
    expectedLabel: expected?.label ?? null,
    stages: trackerStages(input.snapshot, visible.length, input.install),
    items: input.snapshot.items.map((item) => ({ name: item.name, quantity: quantityLabel(item.quantity) })),
    photos: visible,
  };
}

import type { PalletPlan } from "@/lib/packing/types";

const FILLS = ["#f2c4c4", "#c9d7f2", "#cfe8d4", "#f3e0b5", "#e0d4f2", "#f5d0c4", "#d5efe8", "#f6d5e3"];

function fillFor(sku: string) {
  let hash = 0;
  for (const char of sku) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return FILLS[hash % FILLS.length] ?? FILLS[0];
}

export function PalletLayout({ pallet }: { pallet: PalletPlan }) {
  const layers = new Map<number, typeof pallet.placements>();
  for (const item of pallet.placements) {
    const list = layers.get(item.z) ?? [];
    list.push(item);
    layers.set(item.z, list);
  }
  const levels = [...layers.keys()].sort((left, right) => left - right);
  return (
    <div className="space-y-3">
      {levels.map((level) => (
        <figure key={level} className="space-y-1">
          {levels.length > 1 ? <figcaption className="text-xs font-semibold">{level} cm</figcaption> : null}
          <svg viewBox={`0 0 ${pallet.lengthCm} ${pallet.widthCm}`} role="img" aria-label={`Pallet ${pallet.index}`} className="h-auto w-full max-w-md rounded-xl border border-line bg-paper text-ink">
            <rect x={0} y={0} width={pallet.lengthCm} height={pallet.widthCm} fill="none" stroke="currentColor" strokeWidth={1} />
            {(layers.get(level) ?? []).map((item) => {
              const clip = `pallet-${pallet.index}-${item.id}`;
              return (
                <g key={item.id}>
                  <clipPath id={clip}>
                    <rect x={item.x} y={item.y} width={item.lengthCm} height={item.widthCm} />
                  </clipPath>
                  <rect x={item.x} y={item.y} width={item.lengthCm} height={item.widthCm} fill={fillFor(item.sku)} stroke="currentColor" strokeWidth={0.8} />
                  <text x={item.x + 1.5} y={item.y + Math.min(item.widthCm - 1, Math.max(6, item.widthCm / 2))} fontSize={Math.max(4, Math.min(7, item.widthCm / 4, item.lengthCm / Math.max(item.sku.length, 1)))} clipPath={`url(#${clip})`} fill="currentColor">
                    {item.sku}
                  </text>
                </g>
              );
            })}
          </svg>
        </figure>
      ))}
    </div>
  );
}

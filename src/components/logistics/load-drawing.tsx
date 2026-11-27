"use client";

import { useId } from "react";
import type { LoadBinView, LoadSpaceLabel } from "@/lib/packing/load-plan";

const FILLS = ["#f2c4c4", "#c9d7f2", "#cfe8d4", "#f3e0b5", "#e0d4f2", "#f5d0c4", "#d5efe8", "#f6d5e3"];

export function fillForSku(sku: string) {
  let hash = 0;
  for (const char of sku) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return FILLS[hash % FILLS.length] ?? FILLS[0]!;
}

export function LoadDrawing({ bin, space, noun }: { bin: LoadBinView; space: LoadSpaceLabel; noun: string }) {
  const uid = useId().replaceAll(":", "");
  const skus = [...new Set(bin.placements.map((item) => item.sku))];
  return (
    <div className="space-y-3">
      <div className="grid gap-4 lg:grid-cols-2">
        <figure className="space-y-1">
          <figcaption className="text-sm font-semibold">Plan</figcaption>
          <svg viewBox={`0 0 ${space.lengthCm} ${space.widthCm}`} role="img" aria-label={`Plan of ${noun} ${bin.index}`} className="h-auto w-full rounded-xl border border-line bg-paper text-ink">
            <rect x={0} y={0} width={space.lengthCm} height={space.widthCm} fill="none" stroke="currentColor" strokeWidth={2} />
            {[...bin.placements].sort((a, b) => a.z - b.z).map((item) => (
              <Box key={`plan-${item.id}`} clip={`${uid}-p-${safe(item.id)}`} x={item.x} y={item.y} width={item.lengthCm} height={item.widthCm} sku={item.sku} />
            ))}
          </svg>
        </figure>
        <figure className="space-y-1">
          <figcaption className="text-sm font-semibold">Side</figcaption>
          <svg viewBox={`0 0 ${space.lengthCm} ${space.heightCm}`} role="img" aria-label={`Side of ${noun} ${bin.index}`} className="h-auto w-full rounded-xl border border-line bg-paper text-ink">
            <rect x={0} y={0} width={space.lengthCm} height={space.heightCm} fill="none" stroke="currentColor" strokeWidth={2} />
            {[...bin.placements].sort((a, b) => b.y - a.y).map((item) => (
              <Box
                key={`side-${item.id}`}
                clip={`${uid}-s-${safe(item.id)}`}
                x={item.x}
                y={space.heightCm - item.z - item.heightCm}
                width={item.lengthCm}
                height={item.heightCm}
                sku={item.sku}
              />
            ))}
          </svg>
        </figure>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {skus.map((sku) => (
          <li key={sku} className="flex items-center gap-2 text-sm">
            <span className="size-3 rounded-sm border border-line" style={{ background: fillForSku(sku) }} />
            {sku}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Box({ clip, x, y, width, height, sku }: { clip: string; x: number; y: number; width: number; height: number; sku: string }) {
  const font = Math.max(8, Math.min(22, height / 3, width / Math.max(sku.length, 1)));
  return (
    <g>
      <clipPath id={clip}>
        <rect x={x} y={y} width={width} height={height} />
      </clipPath>
      <rect x={x} y={y} width={width} height={height} fill={fillForSku(sku)} stroke="currentColor" strokeWidth={1.5} />
      <text x={x + 4} y={y + Math.min(height - 4, Math.max(font, height / 2))} fontSize={font} clipPath={`url(#${clip})`} fill="currentColor">
        {sku}
      </text>
    </g>
  );
}

function safe(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, "-");
}

"use client";

import { useState, type ReactNode } from "react";

/** Covers disabled fields so a hover can explain why they cannot be changed. */
export function LockedFields({ locked, children }: { locked: boolean; children: ReactNode }) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  if (!locked) return children;
  return (
    <div className="relative">
      <fieldset disabled className="min-w-0 opacity-60">
        {children}
      </fieldset>
      <div
        className="absolute inset-0 z-10 cursor-not-allowed"
        onMouseMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const x = Math.min(event.clientX - bounds.left + 12, Math.max(12, bounds.width - 220));
          const y = Math.min(event.clientY - bounds.top + 16, Math.max(8, bounds.height - 36));
          setPoint({ x, y });
        }}
        onMouseLeave={() => setPoint(null)}
      >
        {point ? (
          <span
            role="tooltip"
            className="pointer-events-none absolute z-20 max-w-[14rem] rounded-lg bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground shadow-md ring-1 ring-foreground/10"
            style={{ left: point.x, top: point.y }}
          >
            You do not have permission to edit this
          </span>
        ) : null}
      </div>
    </div>
  );
}

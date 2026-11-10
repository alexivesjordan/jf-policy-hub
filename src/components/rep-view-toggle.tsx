"use client";

import { useState, type ReactNode } from "react";

export function RepViewToggle({
  enabled,
  full,
  sales,
}: {
  enabled: boolean;
  full: ReactNode;
  sales: ReactNode;
}) {
  const [viewAsSales, setViewAsSales] = useState(false);
  return (
    <div className="space-y-6">
      {enabled ? (
        <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-ink">
          <input
            type="checkbox"
            className="size-5 accent-red"
            checked={viewAsSales}
            onChange={(event) => setViewAsSales(event.target.checked)}
          />
          View as sales rep
        </label>
      ) : null}
      {viewAsSales ? sales : full}
    </div>
  );
}

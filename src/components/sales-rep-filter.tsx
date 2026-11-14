"use client";

import { useRouter } from "next/navigation";

export function SalesRepFilter({ reps, value }: { reps: { id: string; name: string }[]; value: string }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm font-semibold">
      Rep
      <select
        aria-label="Rep"
        className="h-11 rounded-full border border-line bg-card px-3 text-sm font-semibold"
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          router.push(next ? `/sales?rep=${encodeURIComponent(next)}` : "/sales");
        }}
      >
        <option value="">All</option>
        {reps.map((rep) => (
          <option key={rep.id} value={rep.id}>{rep.name}</option>
        ))}
      </select>
    </label>
  );
}

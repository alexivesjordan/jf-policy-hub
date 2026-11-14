"use client";

import { useRouter } from "next/navigation";

export function PersonFilter({
  people,
  value,
  base,
}: {
  people: { id: string; name: string }[];
  value: string;
  base: string;
}) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm font-semibold">
      Person
      <select
        aria-label="Person"
        className="h-11 rounded-full border border-line bg-card px-3 text-sm font-semibold"
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          router.push(next ? `${base}?person=${encodeURIComponent(next)}` : base);
        }}
      >
        <option value="">All</option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>{person.name}</option>
        ))}
      </select>
    </label>
  );
}

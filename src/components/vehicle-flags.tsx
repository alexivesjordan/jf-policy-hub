"use client";

import { useState } from "react";
import { resolveVehicleFlag, type VehicleFlag } from "@/features/operations/vehicle-flags";

export function VehicleFlags({ flags }: { flags: VehicleFlag[] }) {
  const [rows, setRows] = useState(flags);
  const [message, setMessage] = useState<string | null>(null);

  async function resolve(id: string) {
    const result = await resolveVehicleFlag(id);
    setMessage(result.message);
    if (result.ok) {
      setRows((current) => current.map((flag) => flag.id === id ? { ...flag, status: "resolved" } : flag));
    }
  }

  const open = rows.filter((flag) => flag.status === "open");
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3 rounded-3xl border border-line bg-card px-5 py-4">
      <h2 className="font-display text-2xl">Vehicle flags <span className="font-mono text-base">{open.length}</span></h2>
      {message ? <p className="text-sm">{message}</p> : null}
      <ul className="space-y-4">
        {rows.map((flag) => (
          <li key={flag.id} className="space-y-2 border-t border-line pt-3">
            <p className="font-semibold">{flag.registration} · {flag.reason === "damage" ? "New damage" : "Not fit to drive"} · {flag.status}</p>
            <p className="text-sm text-grey">{flag.orderNumber}</p>
            {flag.note ? <p>{flag.note}</p> : null}
            {flag.photos.length > 0 ? (
              <ul className="grid grid-cols-3 gap-2">
                {flag.photos.map((photo) => (
                  <li key={photo.id}>
                    {photo.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo.url} alt="" className="aspect-square w-full rounded-xl object-cover" />
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {flag.status === "open" ? (
              <button type="button" onClick={() => void resolve(flag.id)} className="min-h-12 text-sm font-semibold underline decoration-primary">
                Mark resolved
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

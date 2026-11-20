"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PhotoPicker, type StoredPhoto } from "@/components/field/photo-picker";
import { Input, Select } from "@/components/pulse/ui";
import { submitVehicleCheck } from "@/features/field/prep-actions";
import type { FleetVan, PersonOption, VehicleCheckView } from "@/features/field/queries";

const CHECKS = [
  ["lights", "Lights"],
  ["indicators", "Indicators"],
  ["mirrors", "Mirrors"],
  ["brakes", "Brakes"],
  ["fueled", "Fueled?"],
] as const;

type Tick = (typeof CHECKS)[number][0];

export function VehicleCheckForm({
  installId,
  currentUserId,
  drivers,
  vans,
  defaultVanId,
  existing,
}: {
  installId: string;
  currentUserId: string;
  drivers: PersonOption[];
  vans: FleetVan[];
  defaultVanId: string | null;
  existing: VehicleCheckView | null;
}) {
  const [driverId, setDriverId] = useState(drivers.some((driver) => driver.id === currentUserId) ? currentUserId : "");
  const [vanId, setVanId] = useState(defaultVanId && vans.some((van) => van.id === defaultVanId) ? defaultVanId : "");
  const [ticks, setTicks] = useState<Record<Tick, boolean>>({ lights: false, indicators: false, mirrors: false, brakes: false, fueled: false });
  const [tyrePressure, setTyrePressure] = useState("");
  const [treadDepth, setTreadDepth] = useState("");
  const [noWarningLights, setNoWarningLights] = useState(false);
  const [newDamage, setNewDamage] = useState<"yes" | "no" | "">("");
  const [damageNote, setDamageNote] = useState("");
  const [photos, setPhotos] = useState<StoredPhoto[]>([]);
  const [fitToDrive, setFitToDrive] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(Boolean(existing));

  if (done) {
    return (
      <div className="space-y-2">
        <h2 className="font-display text-3xl">Vehicle check is in</h2>
        {existing?.newDamage ? <p>New damage. {existing.damageNote}</p> : null}
        {existing && !existing.fitToDrive ? <p>Not fit to drive.</p> : null}
      </div>
    );
  }

  async function submit() {
    setPending(true);
    setMessage(null);
    if (newDamage !== "yes" && newDamage !== "no") {
      setPending(false);
      setMessage("Say whether there is new exterior damage.");
      return;
    }
    if (!tyrePressure.trim() || !treadDepth.trim()) {
      setPending(false);
      setMessage(!tyrePressure.trim() ? "Enter the tyre pressure." : "Enter the tread depth.");
      return;
    }
    const pressure = Number(tyrePressure);
    const tread = Number(treadDepth);
    const result = await submitVehicleCheck(installId, {
      driverId,
      vanId,
      lights: ticks.lights,
      indicators: ticks.indicators,
      mirrors: ticks.mirrors,
      brakes: ticks.brakes,
      fueled: ticks.fueled,
      tyrePressure: pressure,
      treadDepth: tread,
      noWarningLights,
      newDamage: newDamage === "yes",
      damageNote,
      damageFileIds: photos.map((photo) => photo.id),
      fitToDrive,
      confirmed,
    });
    setPending(false);
    setMessage(result.message);
    if (result.ok) {
      setDone(true);
      router.refresh();
    }
  }

  return (
    <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h2 className="font-display text-3xl">Vehicle check</h2>
      <label className="block space-y-2 text-sm font-semibold">
        Driver
        <Select value={driverId} aria-label="Driver" onChange={(event) => setDriverId(event.target.value)}>
          <option value="">Choose</option>
          {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
        </Select>
      </label>
      <label className="block space-y-2 text-sm font-semibold">
        Vehicle
        <Select value={vanId} aria-label="Vehicle" onChange={(event) => setVanId(event.target.value)}>
          <option value="">Choose</option>
          {vans.map((van) => <option key={van.id} value={van.id}>{van.name ? `${van.registration} · ${van.name}` : van.registration}</option>)}
        </Select>
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Check each of the following and tick them if they are in full working order</legend>
        {CHECKS.map(([key, label]) => (
          <label key={key} className="flex min-h-12 items-center gap-3">
            <input type="checkbox" checked={ticks[key]} onChange={(event) => setTicks((current) => ({ ...current, [key]: event.target.checked }))} />
            {label}
          </label>
        ))}
      </fieldset>
      <label className="block space-y-2 text-sm font-semibold">
        Tyre pressure
        <Input inputMode="decimal" value={tyrePressure} onChange={(event) => setTyrePressure(event.target.value)} />
      </label>
      <label className="block space-y-2 text-sm font-semibold">
        Tread depth
        <Input inputMode="decimal" value={treadDepth} onChange={(event) => setTreadDepth(event.target.value)} />
      </label>
      <label className="flex min-h-12 items-center gap-3">
        <input type="checkbox" checked={noWarningLights} onChange={(event) => setNoWarningLights(event.target.checked)} />
        No warning lights on dashboard?
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Any new exterior damage?</legend>
        <label className="flex min-h-12 items-center gap-3">
          <input type="radio" name="damage" checked={newDamage === "yes"} onChange={() => setNewDamage("yes")} />
          Yes
        </label>
        <label className="flex min-h-12 items-center gap-3">
          <input type="radio" name="damage" checked={newDamage === "no"} onChange={() => setNewDamage("no")} />
          No
        </label>
      </fieldset>
      {newDamage === "yes" ? (
        <div className="space-y-3">
          <label className="block space-y-2 text-sm font-semibold">
            Describe new damage
            <Input value={damageNote} onChange={(event) => setDamageNote(event.target.value)} />
          </label>
          <PhotoPicker installId={installId} token={null} kind="vehicle_damage" photos={photos} onChange={setPhotos} label="Photograph the damage" />
        </div>
      ) : null}
      <label className="flex min-h-12 items-center gap-3">
        <input type="checkbox" checked={fitToDrive} onChange={(event) => setFitToDrive(event.target.checked)} />
        Is vehicle fit to drive?
      </label>
      <label className="flex min-h-12 items-start gap-3">
        <input type="checkbox" className="mt-1" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        By ticking this box, I confirm that the above checks have been carried out
      </label>
      {message ? <p className="text-sm font-semibold">{message}</p> : null}
      <button type="submit" disabled={pending} className="min-h-14 w-full rounded-full bg-red text-base font-semibold text-white disabled:opacity-60">
        {pending ? "Saving" : "Submit vehicle check"}
      </button>
    </form>
  );
}

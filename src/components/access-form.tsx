"use client";

import { useActionState, useState } from "react";
import { Banner, Button, Field, Input } from "@/components/pulse/ui";
import { submitAccessForm } from "@/features/operations/access-actions";

type Line = { label?: string; rate?: number; unit?: string; basis?: string; mileage?: number };

export function AccessForm({
  token,
  versionLabel,
  lines,
}: {
  token: string;
  versionLabel: string;
  lines: Line[];
}) {
  const [state, action, pending] = useActionState(submitAccessForm, null);
  const [scrolled, setScrolled] = useState(false);

  if (state?.ok) {
    return <Banner tone="success">{state.message}</Banner>;
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      <YesNo name="groundFloor" label="Is the install room on the ground floor?" defaultYes />
      <Field label="If not, which floor?">
        <Input name="floorNumber" inputMode="numeric" />
      </Field>
      <YesNo name="hasLift" label="Is there a lift?" />
      <YesNo name="levelStepFree" label="Is the route level and step-free?" defaultYes />
      <YesNo name="doubleDoors" label="Are all doors double doors, or at least 1,400 mm by 1,950 mm clear?" defaultYes />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Smallest opening width mm">
          <Input name="openingWidth" inputMode="numeric" />
        </Field>
        <Field label="Height mm">
          <Input name="openingHeight" inputMode="numeric" />
        </Field>
      </div>
      <YesNo name="tailLift" label="Can a tail-lift lorry unload next to the entrance?" defaultYes />
      <Field label="Where is the drop zone?">
        <Input name="dropZone" />
      </Field>
      <YesNo name="startAtEight" label="Can the crew start at 08:00, with the room clear and the floor finished?" defaultYes />
      <YesNo name="roomClear" label="Will the room be clear?" defaultYes />
      <YesNo name="floorFinished" label="Will the floor be finished?" defaultYes />
      <YesNo name="townCentre" label="Is the site in a town or city centre?" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Site hours start">
          <Input name="hoursStart" type="time" defaultValue="08:00" />
        </Field>
        <Field label="Site hours end">
          <Input name="hoursEnd" type="time" defaultValue="17:00" />
        </Field>
      </div>
      <Field label="Photos of the entrance, route, room, and parking">
        <Input name="photos" type="file" accept="image/*" multiple />
      </Field>

      <div
        className="max-h-64 overflow-y-auto rounded-3xl border border-line bg-field p-4 text-sm leading-6"
        onScroll={(event) => {
          const node = event.currentTarget;
          if (node.scrollTop + node.clientHeight >= node.scrollHeight - 12) setScrolled(true);
        }}
      >
        <p className="font-semibold text-ink">Additional charges, version {versionLabel}, ex VAT</p>
        <ul className="mt-3 space-y-3">
          {lines.map((line) => (
            <li key={line.label}>
              <p className="text-ink">{line.label}</p>
              <p className="text-grey">
                {line.rate != null ? `£${Number(line.rate).toFixed(2)}` : basisText(line.basis)}
                {line.unit ? ` ${line.unit}` : ""}
                {line.mileage != null ? ` plus £${Number(line.mileage).toFixed(2)} per mile` : ""}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-grey">Scroll to the end of this list before you can accept.</p>
      </div>

      <label className="flex items-start gap-3 text-sm leading-6">
        <input type="checkbox" name="accept" value="yes" disabled={!scrolled} className="mt-1 size-4 accent-[#ce0037]" />
        <span>
          By ticking this box you accept the Jordan Fitness Installation Terms and Conditions (version {versionLabel}), including the additional charges below.
        </span>
      </label>
      <Field label="Your name">
        <Input name="acceptedName" required autoComplete="name" />
      </Field>
      <Button type="submit" disabled={pending || !scrolled} className="w-full">
        {pending ? "Sending..." : "Send access details"}
      </Button>
      {state && !state.ok ? <Banner tone="error">{state.message}</Banner> : null}
    </form>
  );
}

function YesNo({ name, label, defaultYes = false }: { name: string; label: string; defaultYes?: boolean }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-ink">{label}</legend>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name={name} value="yes" defaultChecked={defaultYes} className="accent-[#ce0037]" /> Yes
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name={name} value="no" defaultChecked={!defaultYes} className="accent-[#ce0037]" /> No
        </label>
      </div>
    </fieldset>
  );
}

function basisText(basis?: string) {
  if (basis === "cost_plus_25") return "Cost + 25%";
  if (basis === "at_cost") return "At cost";
  if (basis === "additional_installer_time") return "Charged as additional installer time";
  return basis ?? "See the grid";
}

"use client";

import { useEffect, useState } from "react";
import { Input, Select } from "@/components/pulse/ui";

export type FieldResourceOption = { id: string; name: string; profileId: string | null };

export function FieldResourceSelect({
  resources,
  defaultChoice,
  blankLabel,
  suggestedName,
  exceptProfileId,
  className,
}: {
  resources: FieldResourceOption[];
  defaultChoice: string;
  blankLabel: string;
  suggestedName: string;
  exceptProfileId?: string;
  className?: string;
}) {
  const [choice, setChoice] = useState(defaultChoice);
  const [name, setName] = useState(suggestedName);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched) setName(suggestedName);
  }, [suggestedName, touched]);

  return (
    <div className={className}>
      <Select name="fieldResource" value={choice} aria-label="Field engineer resource" onChange={(event) => setChoice(event.target.value)}>
        <option value="">{blankLabel}</option>
        <option value="office">Office user (not a field engineer)</option>
        <option value="new">New engineer</option>
        {resources.map((resource) => (
          <option key={resource.id} value={resource.id}>
            {resource.name.replace(/^FIXTURE — /, "")}
            {resource.profileId && resource.profileId !== exceptProfileId ? " (linked)" : ""}
          </option>
        ))}
      </Select>
      {choice === "new" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-grey">Name</span>
            <Input name="engineerName" required value={name} onChange={(event) => { setTouched(true); setName(event.target.value); }} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-grey">Role</span>
            <Select name="engineerRole" defaultValue="installer" aria-label="Engineer role">
              <option value="installer">Installer</option>
              <option value="helper">Helper</option>
            </Select>
          </label>
        </div>
      ) : null}
    </div>
  );
}

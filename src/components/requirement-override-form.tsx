"use client";

import { useActionState } from "react";
import { Banner, Button, Field, Input, Select } from "@/components/ui";
import { overrideJobRequirements } from "@/features/operations/price-actions";
import type { JobRequirements } from "@/lib/orbit/requirements";

export function RequirementOverrideForm({
  jobId,
  requirements,
}: {
  jobId: string;
  requirements: JobRequirements;
}) {
  const [state, action, pending] = useActionState(overrideJobRequirements, null);

  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="jobId" value={jobId} />
      <Field label="Installers">
        <Input name="installers" type="number" min={1} max={20} defaultValue={requirements.installers} required />
      </Field>
      <Field label="Licensed drivers">
        <Input name="licensedDrivers" type="number" min={0} max={10} defaultValue={requirements.licensedDrivers} required />
      </Field>
      <Field label="Van size">
        <Select name="vanSize" defaultValue={requirements.vanSize}>
          <option value="small">Small van</option>
          <option value="crafter">Crafter</option>
        </Select>
      </Field>
      <Field label="Vans">
        <Input name="vanCount" type="number" min={1} max={10} defaultValue={requirements.vanCount} required />
      </Field>
      <Field label="Stair climber">
        <Select name="stairClimber" defaultValue={requirements.stairClimber ? "yes" : "no"}>
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </Select>
      </Field>
      <div className="md:col-span-2">
        <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving..." : "Override resources"}</Button>
      </div>
      {state ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { saveRadarSettings, type RadarActionState } from "@/features/radar/actions";
import { settingsToForm } from "@/features/radar/settings";
import type { RadarScoringConfig } from "@/features/radar/types";
import { Banner, Button, Field, Input, TextArea } from "@/components/pulse/ui";

export function RadarSettingsForm({ settings }: { settings: RadarScoringConfig }) {
  const form = settingsToForm(settings);
  const [state, action, pending] = useActionState(saveRadarSettings, null as RadarActionState);
  return (
    <form action={action} className="space-y-6">
      {state?.message ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
      <Field label="Keywords">
        <TextArea name="keywords" defaultValue={form.keywords} rows={10} required />
      </Field>
      <Field label="CPV codes">
        <TextArea name="cpv_codes" defaultValue={form.cpvCodes} rows={4} />
      </Field>
      <Field label="Exclusions">
        <TextArea name="exclusions" defaultValue={form.exclusions} rows={6} />
      </Field>
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="text-sm font-semibold sm:col-span-2">HubSpot</legend>
        <Field label="Pipeline">
          <Input name="hubspot_pipeline_id" defaultValue={form.hubspotPipelineId} />
        </Field>
        <Field label="Stage">
          <Input name="hubspot_stage_id" defaultValue={form.hubspotStageId} />
        </Field>
        <Field label="Owner">
          <Input name="hubspot_owner_id" defaultValue={form.hubspotOwnerId} />
        </Field>
        <Field label="Portal">
          <Input name="hubspot_portal_id" defaultValue={form.hubspotPortalId} />
        </Field>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Value bands</legend>
        {form.bands.map((band, index) => (
          <div key={index} className="grid gap-3 sm:grid-cols-4">
            <Field label="Label">
              <Input name={`band_label_${index}`} defaultValue={band.label} />
            </Field>
            <Field label="Minimum">
              <Input name={`band_min_${index}`} inputMode="decimal" defaultValue={band.min} />
            </Field>
            <Field label="Maximum">
              <Input name={`band_max_${index}`} inputMode="decimal" defaultValue={band.max} />
            </Field>
            <Field label="Points">
              <Input name={`band_points_${index}`} inputMode="numeric" defaultValue={band.points} />
            </Field>
          </div>
        ))}
      </fieldset>
      <Button type="submit" disabled={pending}>{pending ? "Saving..." : "Save"}</Button>
    </form>
  );
}

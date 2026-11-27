"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createMaintenancePlan, setMaintenancePlanStatus } from "@/features/service/actions";
import type { EligibleInstall, MaintenancePlanRow } from "@/features/service/queries";
import { Button, Input } from "@/components/pulse/ui";
import { EmptyState } from "@/components/pulse/states";
import { formatDate } from "@/lib/format";
import { addMonths, cadenceLabel } from "@/lib/service/plan-dates";

const WARRANTY: Record<string, string> = {
  annual: "Annual",
  twice_yearly: "Twice a year",
  annual_bundle: "Annual bundle",
  twice_yearly_bundle: "Twice a year bundle",
};

function statusLabel(status: string) {
  if (status === "paused") return "Paused";
  if (status === "ended") return "Ended";
  return "Active";
}

export function PlanBoard({
  plans,
  installs,
  canEdit,
}: {
  plans: MaintenancePlanRow[];
  installs: EligibleInstall[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installId, setInstallId] = useState<string | null>(null);
  const [startsOn, setStartsOn] = useState("");
  const [nextDueOn, setNextDueOn] = useState("");
  const [statusTarget, setStatusTarget] = useState<{ plan: MaintenancePlanRow; status: "active" | "paused" | "ended" } | null>(null);
  const chosen = installs.find((install) => install.id === installId) ?? null;

  function askCreate(install: EligibleInstall) {
    setStatusTarget(null);
    setInstallId(install.id);
    setStartsOn(install.endOn);
    setNextDueOn(addMonths(install.endOn, install.cadenceMonths));
  }

  async function create() {
    if (!chosen) return;
    setPending(true);
    setError(null);
    const result = await createMaintenancePlan(chosen.id, startsOn, nextDueOn);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setInstallId(null);
    toast.success(result.message);
    router.refresh();
  }

  async function applyStatus() {
    if (!statusTarget) return;
    setPending(true);
    setError(null);
    const result = await setMaintenancePlanStatus(statusTarget.plan.id, statusTarget.status);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setStatusTarget(null);
    toast.success(result.message);
    router.refresh();
  }

  const verb = statusTarget?.status === "paused" ? "Pause" : statusTarget?.status === "ended" ? "End" : "Resume";

  return (
    <div className="space-y-8">
      {error ? <p className="text-sm font-semibold text-red">{error}</p> : null}
      {chosen ? (
        <div className="space-y-3 rounded-3xl border border-line bg-card p-4">
          <p className="font-semibold">Create a plan for {chosen.orderNumber}, {chosen.customerName}?</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold">Starts</span>
              <Input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold">Next due</span>
              <Input type="date" value={nextDueOn} onChange={(event) => setNextDueOn(event.target.value)} />
            </label>
          </div>
          <p className="text-sm text-grey">{cadenceLabel(chosen.cadenceMonths)}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending} onClick={() => void create()}>Create plan</Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setInstallId(null)}>Cancel</Button>
          </div>
        </div>
      ) : null}
      {statusTarget ? (
        <div className="space-y-3 rounded-3xl border border-line bg-card p-4">
          <p className="font-semibold">
            {verb} the plan for {statusTarget.plan.customerName}
            {statusTarget.plan.orderNumber ? ` (${statusTarget.plan.orderNumber})` : ""}?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={pending} onClick={() => void applyStatus()}>{verb}</Button>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setStatusTarget(null)}>Cancel</Button>
          </div>
        </div>
      ) : null}
      {plans.length === 0 ? <EmptyState title="No plans" /> : (
        <div className="overflow-hidden rounded-3xl border border-line bg-card">
          <div className="hidden gap-3 border-b border-line px-4 py-2 text-xs font-semibold text-grey sm:grid sm:grid-cols-[1fr_9rem_8rem_6rem]">
            <span>Site</span>
            <span>Cadence</span>
            <span>Next due</span>
            <span>Status</span>
          </div>
          <ul className="divide-y divide-line">
            {plans.map((plan) => (
              <li key={plan.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_9rem_8rem_6rem] sm:items-center">
                <div className="min-w-0">
                  <p className="break-words font-semibold">{plan.customerName}</p>
                  <p className="break-words text-sm text-grey">{[plan.orderNumber, plan.postcode].filter(Boolean).join(" · ")}</p>
                </div>
                <p className="text-sm">{cadenceLabel(plan.cadenceMonths)}</p>
                <p className="text-sm">{formatDate(plan.nextDueOn)}</p>
                <p className="text-sm font-semibold">{statusLabel(plan.status)}</p>
                {canEdit && plan.status !== "ended" ? (
                  <div className="flex flex-wrap gap-2 sm:col-span-4">
                    {plan.status === "paused" ? (
                      <Button type="button" variant="secondary" disabled={pending} onClick={() => { setInstallId(null); setStatusTarget({ plan, status: "active" }); }}>Resume</Button>
                    ) : (
                      <Button type="button" variant="secondary" disabled={pending} onClick={() => { setInstallId(null); setStatusTarget({ plan, status: "paused" }); }}>Pause</Button>
                    )}
                    <Button type="button" variant="danger" disabled={pending} onClick={() => { setInstallId(null); setStatusTarget({ plan, status: "ended" }); }}>End</Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      <section className="space-y-3">
        <h2 className="font-display text-2xl">Sold installs</h2>
        {installs.length === 0 ? <EmptyState title="No sold installs" /> : (
          <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-card">
            {installs.map((install) => (
              <li key={install.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words font-semibold">{install.customerName}</p>
                  <p className="break-words text-sm text-grey">
                    {install.orderNumber} · {WARRANTY[install.warrantyOption] ?? install.warrantyOption} · {cadenceLabel(install.cadenceMonths)} · Ends {formatDate(install.endOn)}
                  </p>
                  {!install.ready ? <p className="text-sm font-semibold text-red">No postcode</p> : null}
                </div>
                {canEdit && install.ready ? (
                  <Button type="button" variant="secondary" disabled={pending} onClick={() => askCreate(install)}>Create</Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

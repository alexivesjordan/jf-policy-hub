"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MaintenancePlanRow } from "@/features/service/queries";
import { Button } from "@/components/pulse/ui";
import { EmptyState } from "@/components/pulse/states";
import { formatDate } from "@/lib/format";
import { planVisitHref } from "@/lib/service/form-key";
import { cadenceLabel } from "@/lib/service/plan-dates";
import { cn } from "@/lib/utils";

export function DuePlans({
  plans,
  within,
  canEdit,
}: {
  plans: MaintenancePlanRow[];
  within: 30 | 60;
  canEdit: boolean;
}) {
  const router = useRouter();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Link className={cn("inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold", within === 30 ? "border-foreground bg-card" : "border-line")} href="/service?view=due&within=30" aria-current={within === 30 ? "page" : undefined}>30 days</Link>
        <Link className={cn("inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold", within === 60 ? "border-foreground bg-card" : "border-line")} href="/service?view=due&within=60" aria-current={within === 60 ? "page" : undefined}>60 days</Link>
      </div>
      {plans.length === 0 ? <EmptyState title="No plans due" /> : (
        <ul className="divide-y divide-line overflow-hidden rounded-3xl border border-line bg-card">
          {plans.map((plan) => (
            <li key={plan.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="break-words font-semibold">{plan.customerName}</p>
                <p className="break-words text-sm text-grey">
                  {[plan.orderNumber, plan.postcode].filter(Boolean).join(" · ")} · {cadenceLabel(plan.cadenceMonths)} · Due {formatDate(plan.nextDueOn)}
                </p>
              </div>
              {canEdit ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => router.push(planVisitHref(plan.id, plan.nextDueOn, crypto.randomUUID()))}
                >
                  Create visit
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

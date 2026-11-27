import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState, ErrorState } from "@/components/pulse/states";
import { TextLink } from "@/components/pulse/ui";
import { LoadPlanner } from "@/components/logistics/load-planner";
import { canAdminLoadSpaces, listLoadPlans, listPlannerSpaces, openLoadPlan } from "@/features/logistics/packing/load-queries";

export const metadata = { title: "Load plan" };
export const instant = false;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function londonStamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default async function LoadPlanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requested = one(params.plan);
  let spaces: Awaited<ReturnType<typeof listPlannerSpaces>> = [];
  let plans: Awaited<ReturnType<typeof listLoadPlans>> = [];
  let open: Awaited<ReturnType<typeof openLoadPlan>> = null;
  let canAdmin = false;
  let error = "";
  try {
    [spaces, plans, canAdmin] = await Promise.all([
      listPlannerSpaces(true),
      listLoadPlans(),
      canAdminLoadSpaces(),
    ]);
    if (requested) open = await openLoadPlan(requested);
    if (open && !spaces.some((space) => space.code === open?.spaceCode)) {
      const extra = await listPlannerSpaces(false);
      const match = extra.find((space) => space.code === open?.spaceCode);
      if (match) spaces = [...spaces, match];
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Could not load plans.";
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="print:hidden">
        <PageHeader
          eyebrow="Logistics"
          title="Load plan"
          actions={canAdmin ? <TextLink href="/logistics/load-spaces">Load spaces</TextLink> : null}
        />
      </div>
      {error ? <ErrorState title="Could not load plans" description={error} /> : null}
      {!error && spaces.length === 0 ? (
        <EmptyState
          title="No containers or vehicles are available."
          action={canAdmin ? <TextLink href="/logistics/load-spaces">Load spaces</TextLink> : undefined}
        />
      ) : null}
      {!error && spaces.length > 0 ? (
        <>
          <section className="print:hidden space-y-3">
            <h2 className="font-display text-2xl">Saved</h2>
            {plans.length === 0 ? <EmptyState title="No saved plans." /> : (
              <ul className="divide-y divide-border rounded-3xl border border-border bg-card">
                {plans.map((plan) => (
                  <li key={plan.id}>
                    <a className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2" href={`/logistics/load-plan?plan=${plan.id}`}>
                      <span className="font-semibold">{plan.name}</span>
                      <span className="text-sm text-muted-foreground">{[plan.reference, londonStamp(plan.updatedAt)].filter(Boolean).join(" · ")}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <LoadPlanner key={open?.id ?? "new"} spaces={spaces} open={open} missing={Boolean(requested) && !open} />
        </>
      ) : null}
      <style>{`@media print { aside, header, nav { display: none !important; } }`}</style>
    </div>
  );
}

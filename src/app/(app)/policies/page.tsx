import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { listCategories, listPolicies } from "@/features/policies/queries";
import { formatDate, londonToday, needsDocument, plusDays, statusLabel } from "@/lib/format";
import { oneParam } from "@/lib/utils";
import { Badge, Button, Input, Select, TextLink } from "@/components/pulse/ui";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState, PageSkeleton } from "@/components/pulse/states";
import { requireUser } from "@/lib/auth";

export const instant = false;
export const metadata = { title: "Policies" };

export default function PoliciesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PoliciesBody searchParams={searchParams} />
    </Suspense>
  );
}

async function PoliciesBody({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  await requireUser();
  const params = await searchParams;
  const q = oneParam(params.q) ?? "";
  const category = oneParam(params.category) ?? "";
  const status = oneParam(params.status) ?? "";
  const due = oneParam(params.due) === "1";
  const needs = oneParam(params.needs) === "1";
  const today = londonToday();
  const categories = await listCategories();
  let policies = await listPolicies({
    q,
    category,
    status,
    reviewBefore: due ? plusDays(today, 30) : undefined,
  });

  if (needs) {
    policies = policies.filter((policy) => needsDocument(policy));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pulse People"
        title="Policies"
        actions={
          <>
            <TextLink href="/policies/upload">Upload a policy document</TextLink>
            <TextLink href="/policies/new" variant="secondary">Write a new policy</TextLink>
          </>
        }
      />

      <form className="grid gap-3 rounded-3xl border border-line bg-card p-4 md:grid-cols-4" method="get">
        <label className="space-y-1 text-sm font-semibold md:col-span-2">
          Search
          <Input name="q" defaultValue={q} placeholder="Search titles and text" />
        </label>
        <label className="space-y-1 text-sm font-semibold">
          Category
          <Select name="category" searchable defaultValue={category} aria-label="Category">
            <option value="">All categories</option>
            {categories.map((item) => (
              <option key={item.id} value={item.slug}>{item.name}</option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-sm font-semibold">
          Status
          <Select name="status" defaultValue={status} aria-label="Status">
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </Select>
        </label>
        <div className="md:col-span-4">
          <Button type="submit">Apply filters</Button>
        </div>
      </form>

      {policies.length === 0 ? (
        <EmptyState
          title="No policies match those filters"
          description="Clear the search, or write a new policy if the library is still empty."
          action={<TextLink href="/policies/new">Write a new policy</TextLink>}
        />
      ) : (
        <ul className="space-y-3">
          {policies.map((policy) => {
            const empty = needsDocument(policy);
            return (
              <li key={policy.id} className="rounded-3xl border border-line bg-card px-5 py-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <Link href={`/policies/${policy.id}`} className="text-lg font-semibold text-ink">
                      {policy.title}
                    </Link>
                    <p className="mt-1 text-sm text-ink/70">
                      {policy.category?.name ?? "Uncategorised"} · Review {formatDate(policy.review_date)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge tone={policy.status}>{statusLabel(policy.status)}</Badge>
                      {empty ? <Badge tone="pending">Needs a document</Badge> : null}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {empty ? (
                      <TextLink href={`/policies/upload?policy=${policy.id}`}>Upload</TextLink>
                    ) : (
                      <TextLink href={`/policies/${policy.id}`} variant="secondary">
                        Open
                      </TextLink>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

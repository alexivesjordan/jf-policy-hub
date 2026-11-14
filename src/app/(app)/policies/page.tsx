import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { listAmendments, listCategories, listPolicies } from "@/features/policies/queries";
import { formatDate, formatTimestamp, londonToday, needsDocument, plusDays, statusLabel } from "@/lib/format";
import { moduleAllows } from "@/lib/access";
import { oneParam } from "@/lib/utils";
import { Badge, Button, Input, Select, TextLink } from "@/components/pulse/ui";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState, PageSkeleton } from "@/components/pulse/states";
import { StatusTabs } from "@/components/status-tabs";
import { getCurrentProfile, requireUser } from "@/lib/auth";

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
  const profile = await getCurrentProfile();
  const params = await searchParams;
  const q = oneParam(params.q) ?? "";
  const category = oneParam(params.category) ?? "";
  const status = oneParam(params.status) ?? "";
  const due = oneParam(params.due) === "1" || status === "needs-review";
  const needs = oneParam(params.needs) === "1";
  const today = londonToday();
  const categories = await listCategories();
  const suggestions = await listAmendments("pending");
  let policies = await listPolicies({
    q,
    category,
    status: status === "needs-review" ? "" : status,
    reviewBefore: due ? plusDays(today, 30) : undefined,
  });

  if (needs) {
    policies = policies.filter((policy) => needsDocument(policy));
  }

  const pill = (next: string) => {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    if (category) search.set("category", category);
    if (needs) search.set("needs", "1");
    if (next) search.set("status", next);
    const text = search.toString();
    return text ? `/policies?${text}` : "/policies";
  };
  const editor = profile ? moduleAllows(profile, "people", "edit") : false;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pulse People"
        title="Policies"
        actions={
          <>
            {editor ? <TextLink href="/admin/categories" variant="ghost">Categories</TextLink> : null}
            <TextLink href="/policies/upload">Upload</TextLink>
            <TextLink href="/policies/new" variant="secondary">New policy</TextLink>
          </>
        }
      />

      <StatusTabs
        label="Policy status"
        value={status === "needs-review" || due ? "needs-review" : status}
        tabs={[
          { value: "", label: "All", href: pill("") },
          { value: "draft", label: "Draft", href: pill("draft") },
          { value: "active", label: "Active", href: pill("active") },
          { value: "needs-review", label: "Needs review", href: pill("needs-review") },
          { value: "archived", label: "Archived", href: pill("archived") },
        ]}
      />

      <form className="grid gap-3 rounded-3xl border border-line bg-card p-4 md:grid-cols-4" method="get">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        {needs ? <input type="hidden" name="needs" value="1" /> : null}
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
        <div className="flex items-end">
          <Button type="submit">Search</Button>
        </div>
      </form>

      {suggestions.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Suggestions</h2>
          <ul className="divide-y divide-line rounded-3xl border border-line bg-card px-4">
            {suggestions.map((item) => (
              <li key={item.id}>
                <Link href={`/amendments/${item.id}`} className="flex items-baseline justify-between gap-3 py-3 text-sm hover:underline">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{item.policy?.title ?? "Policy"}</span>
                    <span className="text-grey"> · {item.summary}</span>
                  </span>
                  <span className="shrink-0 text-grey">{formatTimestamp(item.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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

import Link from "next/link";
import { listCategories, listPolicies } from "@/features/policies/queries";
import { formatDate, londonToday, needsDocument, plusDays, statusLabel } from "@/lib/format";
import { oneParam } from "@/lib/utils";
import { Badge, TextLink } from "@/components/ui";
import { requireUser } from "@/lib/auth";

export const instant = false;
export const metadata = { title: "Policies" };

export default async function PoliciesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-grey">Orbit People</p>
          <h1 className="font-display mt-2 text-4xl">Policies</h1>
          <p className="mt-2 max-w-2xl text-ink/75">
            Upload a finished Word or PDF file into a placeholder, or open a policy and write it here.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <TextLink href="/policies/upload">Upload a policy document</TextLink>
          <TextLink href="/policies/new" variant="secondary">
            Write a new policy
          </TextLink>
        </div>
      </div>

      <form className="grid gap-3 rounded-3xl border border-line bg-card p-4 md:grid-cols-4" method="get">
        <label className="space-y-1 text-sm font-semibold md:col-span-2">
          Search
          <input name="q" defaultValue={q} placeholder="Search titles and text" className="w-full rounded-2xl border border-line bg-field px-3 py-2.5 font-normal" />
        </label>
        <label className="space-y-1 text-sm font-semibold">
          Category
          <select name="category" defaultValue={category} className="w-full rounded-2xl border border-line bg-field px-3 py-2.5 font-normal">
            <option value="">All categories</option>
            {categories.map((item) => (
              <option key={item.id} value={item.slug}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-semibold">
          Status
          <select name="status" defaultValue={status} className="w-full rounded-2xl border border-line bg-field px-3 py-2.5 font-normal">
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <div className="md:col-span-4">
          <button type="submit" className="rounded-full bg-red px-4 py-2 text-sm font-semibold text-white">
            Apply filters
          </button>
        </div>
      </form>

      {policies.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-line bg-card px-5 py-8 text-ink/70">
          No policies match those filters.
        </p>
      ) : (
        <ul className="space-y-3">
          {policies.map((policy) => {
            const empty = needsDocument(policy);
            return (
              <li key={policy.id} className="rounded-3xl border border-line bg-card px-5 py-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <Link href={`/policies/${policy.id}`} className="text-lg font-semibold text-white">
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

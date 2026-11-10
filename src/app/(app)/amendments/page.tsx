import Link from "next/link";
import { listAmendments } from "@/features/policies/queries";
import { requireUser } from "@/lib/auth";
import { formatDate, formatTimestamp, severityLabel, statusLabel } from "@/lib/format";
import { oneParam } from "@/lib/utils";
import { Badge } from "@/components/pulse/ui";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState } from "@/components/pulse/states";
import { StatusTabs } from "@/components/status-tabs";

export const instant = false;
export const metadata = { title: "Review queue" };

const filters = [
  { value: "", label: "All" },
  { value: "pending", label: "Waiting" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "auto-applied", label: "Automatic" },
];

export default async function AmendmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireUser();
  const status = oneParam((await searchParams).status) ?? "";
  const amendments = await listAmendments(status);
  const reviewer = profile.role === "admin" || profile.role === "approver";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Pulse People"
        title="Review queue"
        description={
          reviewer
            ? "Review proposed policy text, then approve it, edit it, or reject it with a comment."
            : "Suggestions you and the research agent have sent for review."
        }
      />
      <StatusTabs
        label="Review status"
        value={status}
        tabs={filters.map((filter) => ({
          value: filter.value,
          label: filter.label,
          href: filter.value ? `/amendments?status=${filter.value}` : "/amendments",
        }))}
      />
      {amendments.length === 0 ? (
        <EmptyState title="Nothing in this list" description="New suggestions will show up here when someone sends one." />
      ) : (
        <ul className="space-y-3">
          {amendments.map((item) => (
            <li key={item.id}>
              <Link href={`/amendments/${item.id}`} className="block rounded-3xl border border-line bg-card px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={item.status === "pending" ? "pending" : item.status === "rejected" ? "bad" : item.status === "auto-applied" ? "auto" : "good"}>
                    {statusLabel(item.status)}
                  </Badge>
                  <Badge>{severityLabel(item.severity)} severity</Badge>
                  <Badge tone="neutral">{item.created_by === "research agent" ? "Research agent" : "Colleague"}</Badge>
                </div>
                <p className="mt-2 text-lg font-semibold">{item.policy?.title ?? "Policy"}</p>
                <p className="text-sm text-ink/80">{item.summary}</p>
                <p className="mt-1 text-xs text-ink/60">
                  {formatTimestamp(item.created_at)}
                  {item.effective_date ? ` · Effective ${formatDate(item.effective_date)}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

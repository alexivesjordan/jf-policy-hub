import Link from "next/link";
import { dashboardCounts, listPolicies, listRecentVersions } from "@/features/policies/queries";
import { requireUser } from "@/lib/auth";
import { actorName, formatDate, formatTimestamp, greetingName, londonToday, plusDays } from "@/lib/format";
import { Card } from "@/components/ui";

export const metadata = { title: "Orbit People" };

export default async function DashboardPage() {
  const profile = await requireUser();
  const today = londonToday();
  const horizon = plusDays(today, 30);
  const [counts, due, recent] = await Promise.all([
    dashboardCounts(horizon),
    listPolicies({ reviewBefore: horizon }),
    listRecentVersions(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-yellow">Orbit People</p>
        <h1 className="font-display mt-2 text-4xl">Hello {greetingName(profile)}</h1>
        <p className="mt-2 max-w-2xl text-lg text-white/70">
          Suggestions waiting for a decision, policies that need a review, and the latest edits.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Stat href="/amendments?status=pending" label="Suggestions waiting" value={counts.pending} />
        <Stat href="/policies?due=1" label="Policies due for review" value={counts.due} />
        <Stat href="/policies?needs=1" label="Waiting for a document" value={counts.placeholders} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="font-display text-2xl">Due for review</h2>
          {due.length === 0 ? (
            <p className="mt-3 text-sm text-ink/70">Nothing is due in the next 30 days.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {due.slice(0, 8).map((policy) => (
                <li key={policy.id} className="flex items-start justify-between gap-3">
                  <Link href={`/policies/${policy.id}`} className="font-semibold text-yellow underline-offset-2 hover:underline">
                    {policy.title}
                  </Link>
                  <span className="shrink-0 text-sm text-ink/70">
                    {policy.review_date && policy.review_date < today ? "Overdue" : formatDate(policy.review_date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h2 className="font-display text-2xl">Recent changes</h2>
          {recent.length === 0 ? (
            <p className="mt-3 text-sm text-ink/70">No edits yet.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {recent.map((version) => (
                <li key={version.id}>
                  <Link href={`/policies/${version.policy_id}`} className="font-semibold text-yellow underline-offset-2 hover:underline">
                    {version.policy?.title ?? "Policy"}
                  </Link>
                  <p className="text-sm text-ink/80">{version.change_summary}</p>
                  <p className="text-xs text-ink/60">
                    {actorName(version.author)} · {formatTimestamp(version.created_at)} · Version {version.version_number}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ href, label, value }: { href: string; label: string; value: number }) {
  return (
    <Link href={href} className="rounded-3xl border border-line bg-card p-5 shadow-sm transition hover:-translate-y-0.5">
      <p className="text-sm font-semibold text-ink/70">{label}</p>
      <p className="mt-2 font-mono text-4xl tabular-nums text-yellow">{value}</p>
    </Link>
  );
}

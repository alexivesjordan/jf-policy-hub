import { DiffView } from "@/components/diff-view";
import { ReviewForm } from "@/components/review-form";
import { Banner, Badge, Card } from "@/components/ui";
import { getAmendment } from "@/features/policies/queries";
import { requireUser } from "@/lib/auth";
import { displayName, formatDate, formatTimestamp, severityLabel, statusLabel } from "@/lib/format";
import { oneParam } from "@/lib/utils";

export const metadata = { title: "Review suggestion" };

export default async function AmendmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireUser();
  const { id } = await params;
  const done = oneParam((await searchParams).done) === "1";
  const amendment = await getAmendment(id);
  const reviewer = profile.role === "admin" || profile.role === "approver";
  const current = amendment.policy?.current_content ?? "";

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-pine">{amendment.policy?.title}</p>
        <h1 className="font-display mt-1 text-4xl">{amendment.summary}</h1>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone={amendment.status === "pending" ? "pending" : amendment.status === "rejected" ? "bad" : "good"}>
            {statusLabel(amendment.status)}
          </Badge>
          <Badge>{severityLabel(amendment.severity)} severity</Badge>
        </div>
      </div>

      {done ? <Banner tone="success">Decision saved.</Banner> : null}

      <Card>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-ink/60">Suggested by</dt>
            <dd className="font-semibold">
              {amendment.created_by === "research agent" ? "Research agent" : displayName(amendment.creator ?? null)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink/60">Submitted</dt>
            <dd className="font-semibold">{formatTimestamp(amendment.created_at)}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink/60">Jurisdiction</dt>
            <dd className="font-semibold">{amendment.jurisdiction || "Not set"}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink/60">Effective date</dt>
            <dd className="font-semibold">{formatDate(amendment.effective_date)}</dd>
          </div>
        </dl>
        {amendment.legal_change_description ? (
          <p className="mt-4 text-sm leading-6">{amendment.legal_change_description}</p>
        ) : null}
        {amendment.source_urls.length > 0 ? (
          <ul className="mt-3 space-y-1 text-sm">
            {amendment.source_urls.map((url) => (
              <li key={url}>
                <a href={url} className="text-pine underline" rel="noreferrer" target="_blank">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {amendment.review_comment ? (
          <p className="mt-4 rounded-2xl bg-paper px-3 py-2 text-sm">Review note: {amendment.review_comment}</p>
        ) : null}
        {amendment.reviewer ? (
          <p className="mt-2 text-xs text-ink/60">
            Reviewed by {displayName(amendment.reviewer)} · {formatTimestamp(amendment.reviewed_at)}
          </p>
        ) : null}
      </Card>

      <section className="space-y-3">
        <h2 className="font-display text-2xl">Current policy and suggested text</h2>
        <DiffView before={current} after={amendment.proposed_content} leftLabel="Current policy" rightLabel="Suggestion" />
      </section>

      {amendment.status === "pending" && reviewer ? (
        <Card>
          <h2 className="font-display mb-4 text-2xl">Your decision</h2>
          <ReviewForm amendmentId={amendment.id} proposed={amendment.proposed_content} />
        </Card>
      ) : null}

      {amendment.status === "pending" && !reviewer ? (
        <Banner>An approver needs to review this suggestion before it changes the policy.</Banner>
      ) : null}
    </div>
  );
}

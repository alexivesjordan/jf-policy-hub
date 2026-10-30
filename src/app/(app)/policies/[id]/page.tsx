import Link from "next/link";
import { UploadForm } from "@/components/upload-form";
import { DiffView } from "@/components/diff-view";
import { PolicyContent } from "@/components/policy-content";
import { Banner, Badge, Card, TextLink } from "@/components/ui";
import { getPolicy, listPolicyAudit, listVersions } from "@/features/policies/queries";
import { requireUser } from "@/lib/auth";
import { actorName, displayName, formatDate, formatTimestamp, needsDocument, statusLabel } from "@/lib/format";
import { oneParam } from "@/lib/utils";

export const instant = false;

const auditLabels: Record<string, string> = {
  "policy.created": "Policy created",
  "policy.updated": "Policy updated",
  "amendment.submitted": "Suggestion submitted",
  "amendment.approved": "Suggestion approved",
  "amendment.rejected": "Suggestion rejected",
  "amendment.auto_applied": "Suggestion applied automatically",
};

export default async function PolicyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const { id } = await params;
  const query = await searchParams;
  const uploaded = oneParam(query.uploaded);
  const [policy, versions, audit] = await Promise.all([getPolicy(id), listVersions(id), listPolicyAudit(id)]);
  const empty = needsDocument(policy);
  const previous = versions[1];
  const latest = versions[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <p className="text-sm font-semibold text-grey">{policy.category?.name}</p>
          <h1 className="font-display mt-1 text-4xl">{policy.title}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone={policy.status}>{statusLabel(policy.status)}</Badge>
            {empty ? <Badge tone="pending">Needs a document</Badge> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <TextLink href={`/policies/${policy.id}/edit`}>Edit text</TextLink>
          <TextLink href={`/policies/${policy.id}/suggest`} variant="secondary">
            Suggest a change
          </TextLink>
          <TextLink href={`/policies/${policy.id}/history`} variant="ghost">
            History
          </TextLink>
        </div>
      </div>

      {uploaded === "docx" ? (
        <Banner tone="success">
          Word document uploaded. The text below is what we read from the file. Use Edit text if you want to tidy it.
        </Banner>
      ) : null}
      {uploaded === "pdf" ? (
        <Banner tone="success">PDF stored with this policy. Download it below. The original file is kept as uploaded.</Banner>
      ) : null}
      {uploaded === "auto" ? (
        <Banner tone="success">A low-severity suggestion was applied automatically and saved as a new version.</Banner>
      ) : null}

      <Card>
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-sm text-ink/60">Owner</dt>
            <dd className="font-semibold">{displayName(policy.owner)}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink/60">Review date</dt>
            <dd className="font-semibold">{formatDate(policy.review_date)}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink/60">Last updated</dt>
            <dd className="font-semibold">{formatTimestamp(policy.updated_at)}</dd>
          </div>
        </dl>
        {policy.source_file_name ? (
          <p className="mt-4 text-sm">
            Attached file:{" "}
            <Link href={`/policies/${policy.id}/file`} className="font-semibold text-white underline decoration-red">
              {policy.source_file_name}
            </Link>
          </p>
        ) : null}
      </Card>

      {empty ? (
        <Card>
          <h2 className="font-display text-2xl">This policy is waiting for a document</h2>
          <p className="mt-2 text-sm leading-6 text-ink/75">
            Upload the finished Word or PDF file. Word files become editable text. Either way, the upload is saved as a new version.
          </p>
          <div className="mt-5">
            <UploadForm
              policies={[]}
              categories={[]}
              locked={{ id: policy.id, title: policy.title, hasContent: false }}
            />
          </div>
        </Card>
      ) : (
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-display text-2xl">Policy text</h2>
            <TextLink href={`/policies/upload?policy=${policy.id}`} variant="secondary">
              Upload a new file
            </TextLink>
          </div>
          {policy.current_content.trim() ? (
            <PolicyContent markdown={policy.current_content} />
          ) : (
            <p className="text-sm text-ink/70">
              There is no editable text yet. The attached file is the source document.
            </p>
          )}
        </Card>
      )}

      {latest && previous ? (
        <section className="space-y-3">
          <h2 className="font-display text-2xl">Latest change</h2>
          <p className="text-sm text-ink/70">
            Version {previous.version_number} to version {latest.version_number}: {latest.change_summary}
          </p>
          <DiffView
            before={previous.content}
            after={latest.content}
            leftLabel={`Version ${previous.version_number}`}
            rightLabel={`Version ${latest.version_number}`}
          />
        </section>
      ) : null}

      <Card>
        <h2 className="font-display text-2xl">Activity</h2>
        <ul className="mt-4 space-y-3">
          {audit.length === 0 ? <li className="text-sm text-ink/70">No activity yet.</li> : null}
          {audit.map((entry) => (
            <li key={entry.id} className="text-sm">
              <span className="font-semibold">{auditLabels[entry.action] ?? entry.action}</span>
              <span className="text-ink/60"> · {actorName(entry.actor)} · {formatTimestamp(entry.created_at)}</span>
              {typeof entry.details.summary === "string" ? <p className="text-ink/80">{entry.details.summary}</p> : null}
              {typeof entry.details.comment === "string" ? <p className="text-ink/80">{entry.details.comment}</p> : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

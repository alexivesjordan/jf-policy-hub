import { DiffView } from "@/components/diff-view";
import { getPolicy, listVersions } from "@/features/policies/queries";
import { requireUser } from "@/lib/auth";
import { actorName, formatTimestamp } from "@/lib/format";
import { oneParam } from "@/lib/utils";

export const metadata = { title: "Version history" };

export default async function HistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const { id } = await params;
  const query = await searchParams;
  const [policy, versions] = await Promise.all([getPolicy(id), listVersions(id)]);
  const newest = versions[0]?.version_number;
  const older = versions[1]?.version_number ?? newest;
  const from = Number(oneParam(query.from) ?? older);
  const to = Number(oneParam(query.to) ?? newest);
  const left = versions.find((version) => version.version_number === from);
  const right = versions.find((version) => version.version_number === to);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl">History</h1>
        <p className="mt-2 text-ink/75">{policy.title}</p>
      </div>

      <form method="get" className="flex flex-col gap-3 rounded-3xl border border-line bg-card p-4 md:flex-row md:items-end">
        <label className="text-sm font-semibold">
          From
          <select name="from" defaultValue={String(from)} className="mt-1 block w-full rounded-2xl border border-line bg-white px-3 py-2 font-normal">
            {versions.map((version) => (
              <option key={version.id} value={version.version_number}>
                Version {version.version_number}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold">
          To
          <select name="to" defaultValue={String(to)} className="mt-1 block w-full rounded-2xl border border-line bg-white px-3 py-2 font-normal">
            {versions.map((version) => (
              <option key={version.id} value={version.version_number}>
                Version {version.version_number}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-full bg-pine px-4 py-2 text-sm font-semibold text-white">
          Show the difference
        </button>
      </form>

      {left && right ? (
        <DiffView
          before={left.content}
          after={right.content}
          leftLabel={`Version ${left.version_number}`}
          rightLabel={`Version ${right.version_number}`}
        />
      ) : (
        <p className="text-sm text-ink/70">Choose two versions to compare.</p>
      )}

      <ol className="space-y-3">
        {versions.map((version) => (
          <li key={version.id} className="rounded-3xl border border-line bg-card px-5 py-4">
            <p className="font-semibold">Version {version.version_number}</p>
            <p className="text-sm text-ink/80">{version.change_summary}</p>
            <p className="text-xs text-ink/60">
              {actorName(version.author)} · {formatTimestamp(version.created_at)}
            </p>
            {version.reason ? <p className="mt-2 text-sm">Reason: {version.reason}</p> : null}
            {version.legal_source ? <p className="text-sm">Legal source: {version.legal_source}</p> : null}
            {version.source_file_name ? <p className="text-sm">File: {version.source_file_name}</p> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

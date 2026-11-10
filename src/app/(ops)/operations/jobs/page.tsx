import { JobsBoard } from "@/components/jobs-board";
import { getOfficeContext, listJobs } from "@/features/operations/queries";
import { canOverrideRequirements } from "@/lib/pulse/requirements";
import { requireOperationsUser } from "@/lib/auth";

export const metadata = { title: "Jobs" };

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperationsUser();
  const params = await searchParams;
  const raw = Array.isArray(params.view) ? params.view[0] : params.view;
  const view = raw === "kanban" || raw === "calendar" ? raw : "list";
  const explicit = raw === "list" || raw === "kanban" || raw === "calendar";
  const context = await getOfficeContext();
  let jobs: Awaited<ReturnType<typeof listJobs>> = [];
  let error: string | null = null;
  try {
    jobs = await listJobs();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Could not load jobs.";
  }

  return (
    <JobsBoard
      jobs={jobs}
      view={view}
      explicit={explicit}
      canEdit={canOverrideRequirements({ opsRole: context.ops_role, isOwner: context.is_owner })}
      error={error}
    />
  );
}

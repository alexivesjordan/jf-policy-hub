import { LoadSpacesEditor } from "@/components/logistics/load-spaces-editor";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState, ErrorState } from "@/components/pulse/states";
import { TextLink } from "@/components/pulse/ui";
import { canAdminLoadSpaces, listPlannerSpaces } from "@/features/logistics/packing/load-queries";

export const metadata = { title: "Load spaces" };

export default async function LoadSpacesPage() {
  let spaces: Awaited<ReturnType<typeof listPlannerSpaces>> = [];
  let canAdmin = false;
  let error = "";
  try {
    [spaces, canAdmin] = await Promise.all([listPlannerSpaces(false), canAdminLoadSpaces()]);
  } catch (err) {
    error = err instanceof Error ? err.message : "Could not load spaces.";
  }

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        eyebrow="Logistics"
        title="Load spaces"
        actions={<TextLink href="/logistics/load-plan">Load plan</TextLink>}
      />
      {error ? <ErrorState title="Could not load spaces" description={error} /> : null}
      {!error && !canAdmin ? <EmptyState title="Load spaces are for logistics admins." /> : null}
      {!error && canAdmin ? <LoadSpacesEditor spaces={spaces} /> : null}
    </div>
  );
}

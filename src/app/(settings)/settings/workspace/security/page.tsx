import { Suspense } from "react";
import { PageHeader } from "@/components/pulse/page-header";
import { Button } from "@/components/pulse/ui";
import { setTwoStepEnforcement } from "@/features/account/two-step-actions";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { oneParam } from "@/lib/utils";
import { redirect } from "next/navigation";

export const instant = false;
export const metadata = { title: "Security policy" };

export default function WorkspaceSecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={null}>
      <SecurityPolicy searchParams={searchParams} />
    </Suspense>
  );
}

async function SecurityPolicy({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireUser();
  if (profile.workspace_role !== "owner") redirect("/settings/account/security");
  const params = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("two_step_enforcement");
  const enabled = data !== false;
  return (
    <div className="max-w-lg space-y-4">
      <PageHeader title="Security" />
      {oneParam(params.saved) === "1" ? <p className="text-sm font-semibold">Saved.</p> : null}
      {oneParam(params.error) === "1" ? <p className="text-sm font-semibold">Could not save that.</p> : null}
      <form action={setTwoStepEnforcement} className="space-y-4">
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
          <input name="enforcement" type="checkbox" defaultChecked={enabled} className="size-5" />
          Require two-step sign-in
        </label>
        <p className="text-sm text-grey">When this is off, nobody is sent to set it up.</p>
        <Button type="submit">Save</Button>
      </form>
    </div>
  );
}

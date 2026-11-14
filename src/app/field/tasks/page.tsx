import { connection } from "next/server";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { FieldFrame } from "@/components/field/frame";
import { listPulseTasks } from "@/features/operations/queries";
import { getCurrentProfile } from "@/lib/auth";
import { formatTimestamp } from "@/lib/format";
import { isFixtureMode, isSupabaseConfigured } from "@/lib/env";

export const metadata = { title: "My tasks" };

export default function FieldTasksPage() {
  return (
    <Suspense fallback={<FieldFrame title="My tasks" back={{ href: "/field", label: "Jobs" }}><p className="text-grey">Loading...</p></FieldFrame>}>
      <Tasks />
    </Suspense>
  );
}

async function Tasks() {
  await connection();
  if (!isSupabaseConfigured() && !isFixtureMode()) {
    return <FieldFrame title="My tasks" back={{ href: "/field", label: "Jobs" }}><p>Add the Supabase keys, then open My tasks again.</p></FieldFrame>;
  }
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/field/tasks");
  if (!profile.access_granted) redirect("/no-access");
  if (!profile.is_active) redirect("/account-inactive");
  const tasks = await listPulseTasks().catch(() => []);
  const mine = tasks.filter((task) => task.assignee_id === profile.id && task.status !== "done" && task.status !== "cancelled");
  return (
    <FieldFrame title="My tasks" back={{ href: "/field", label: "Jobs" }}>
      {mine.length === 0 ? <p>No open tasks.</p> : (
        <ul className="space-y-3">
          {mine.map((task) => (
            <li key={task.id} className="rounded-3xl border border-line bg-card px-4 py-3">
              <p className="font-semibold">{task.title}</p>
              {task.body ? <p className="mt-1 text-sm text-grey">{task.body}</p> : null}
              <p className="mt-2 text-xs text-grey">{task.status.replaceAll("_", " ")} · {formatTimestamp(task.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </FieldFrame>
  );
}

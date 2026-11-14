import { TaskForm } from "@/components/operations-forms";
import { PersonFilter } from "@/components/person-filter";
import { Badge, Card } from "@/components/pulse/ui";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState } from "@/components/pulse/states";
import { getOfficeContext, listPulseTasks } from "@/features/operations/queries";
import { listPeople } from "@/features/policies/queries";
import { formatTimestamp } from "@/lib/format";
import { hasLevel } from "@/lib/module-guard";
import { requireOperationsUser } from "@/lib/auth";
import { oneParam } from "@/lib/utils";

export const metadata = { title: "Tasks" };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperationsUser();
  const person = oneParam((await searchParams).person) ?? "";
  const [context, tasks, people] = await Promise.all([getOfficeContext(), listPulseTasks(), listPeople().catch(() => [])]);
  const canCreate = hasLevel(context.operations, "edit", context.is_owner);
  const names = new Map(people.map((item) => [item.id, item.full_name || item.email]));
  const visible = person ? tasks.filter((task) => task.assignee_id === person) : tasks;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Pulse Operations"
        title="Tasks"
        actions={<PersonFilter people={people.map((item) => ({ id: item.id, name: item.full_name || item.email }))} value={person} base="/operations/tasks" />}
      />
      {canCreate ? (
        <Card>
          <h2 className="font-display text-2xl">Add a task</h2>
          <div className="mt-4">
            <TaskForm />
          </div>
        </Card>
      ) : (
        <p className="text-sm text-grey">Your role can read tasks assigned to you. Creating them is for the install lead, HQ, or the owner.</p>
      )}
      {visible.length === 0 ? (
        <EmptyState title="No tasks yet" description="Add an exception, fleet, or countdown item when the office needs one tracked." />
      ) : (
        <ul className="space-y-3">
          {visible.map((task) => (
            <li key={task.id} className="rounded-3xl border border-line bg-card px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{task.title}</p>
                <Badge tone={task.status === "done" ? "neutral" : "active"}>{task.status.replaceAll("_", " ")}</Badge>
                <Badge>{task.kind}</Badge>
              </div>
              {task.body ? <p className="mt-2 text-sm text-ink/80">{task.body}</p> : null}
              <p className="mt-2 text-xs text-grey">
                {names.get(task.assignee_id ?? "") ?? "Unassigned"} · {task.priority} · {formatTimestamp(task.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

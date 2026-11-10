import { TaskForm } from "@/components/operations-forms";
import { Badge, Card } from "@/components/ui";
import { getOfficeContext, listPulseTasks } from "@/features/operations/queries";
import { formatTimestamp } from "@/lib/format";
import { hasLevel } from "@/lib/module-guard";
import { requireOperationsUser } from "@/lib/auth";

export const metadata = { title: "Tasks" };

export default async function TasksPage() {
  await requireOperationsUser();
  const [context, tasks] = await Promise.all([getOfficeContext(), listPulseTasks()]);
  const canCreate = hasLevel(context.operations, "edit", context.is_owner);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-4xl">Tasks</h1>
        <p className="mt-2 max-w-2xl text-ink/70">
          Exceptions, fleet, and countdown items. The list starts empty until someone adds one. Installs does not write tasks yet.
        </p>
      </div>
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
      {tasks.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-line bg-card px-5 py-8 text-ink/70">
          No tasks yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {tasks.map((task) => (
            <li key={task.id} className="rounded-3xl border border-line bg-card px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{task.title}</p>
                <Badge tone={task.status === "done" ? "neutral" : "active"}>{task.status.replaceAll("_", " ")}</Badge>
                <Badge>{task.kind}</Badge>
              </div>
              {task.body ? <p className="mt-2 text-sm text-ink/80">{task.body}</p> : null}
              <p className="mt-2 text-xs text-grey">
                {task.priority} · {formatTimestamp(task.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

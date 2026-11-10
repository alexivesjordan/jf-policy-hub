import Link from "next/link";
import { markAllPulseNotificationsRead, markPulseNotificationRead } from "@/features/operations/actions";
import { listPulseNotifications } from "@/features/operations/queries";
import { Button } from "@/components/pulse/ui";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState } from "@/components/pulse/states";
import { formatTimestamp } from "@/lib/format";
import { requireOperationsUser } from "@/lib/auth";

export const metadata = { title: "Operations notifications" };

export default async function OperationsNotificationsPage() {
  await requireOperationsUser();
  const notifications = await listPulseNotifications(false);
  const unread = notifications.some((item) => !item.read_at);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Pulse Operations"
        title="Notifications"
        description="Notes from the install office."
        actions={
          unread ? (
            <form action={markAllPulseNotificationsRead}>
              <Button type="submit" variant="secondary">Mark all read</Button>
            </form>
          ) : null
        }
      />
      {notifications.length === 0 ? (
        <EmptyState title="No operations notifications yet" description="If a fixture note was seeded for the owner, it will show up here." />
      ) : (
        <ul className="space-y-3">
          {notifications.map((item) => (
            <li key={item.id} className="rounded-3xl border border-line bg-card px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{item.title}</p>
                  <p className="mt-1 text-sm leading-6 text-ink/80">{item.body}</p>
                  <p className="mt-2 text-xs text-grey">{formatTimestamp(item.created_at)}</p>
                </div>
                {!item.read_at ? <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-red" aria-label="Unread" /> : null}
              </div>
              <div className="mt-3 flex gap-4 text-sm font-semibold">
                {item.link ? (
                  <Link href={item.link} className="text-ink underline decoration-red">
                    Open
                  </Link>
                ) : null}
                {!item.read_at ? (
                  <form action={markPulseNotificationRead}>
                    <input type="hidden" name="id" value={item.id} />
                    <button type="submit" className="text-ink/70">
                      Mark read
                    </button>
                  </form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

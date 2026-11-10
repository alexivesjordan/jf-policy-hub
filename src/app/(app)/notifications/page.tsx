import Link from "next/link";
import { markAllNotificationsRead, markNotificationRead } from "@/features/notifications/actions";
import { listNotifications } from "@/features/policies/queries";
import { requireUser } from "@/lib/auth";
import { Button } from "@/components/pulse/ui";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState } from "@/components/pulse/states";
import { formatTimestamp } from "@/lib/format";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const profile = await requireUser();
  const notifications = await listNotifications(profile.id);
  const unread = notifications.some((item) => !item.read_at);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Pulse People"
        title="Notifications"
        description="Suggestions and updates for you."
        actions={
          unread ? (
            <form action={markAllNotificationsRead}>
              <Button type="submit" variant="secondary">Mark all read</Button>
            </form>
          ) : null
        }
      />
      {notifications.length === 0 ? (
        <EmptyState title="You are up to date" description="Approvers see a note here when a suggestion arrives." />
      ) : (
        <ul className="space-y-3">
          {notifications.map((item) => (
            <li key={item.id} className="rounded-3xl border border-line bg-card px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{item.title}</p>
                  <p className="mt-1 text-sm leading-6 text-ink/80">{item.body}</p>
                  <p className="mt-2 text-xs text-ink/60">{formatTimestamp(item.created_at)}</p>
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
                  <form action={markNotificationRead}>
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

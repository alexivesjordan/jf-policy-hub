import Link from "next/link";
import { markAllNotificationsRead, markNotificationRead } from "@/features/notifications/actions";
import { listNotifications } from "@/features/policies/queries";
import { requireUser } from "@/lib/auth";
import { formatTimestamp } from "@/lib/format";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const profile = await requireUser();
  const notifications = await listNotifications(profile.id);
  const unread = notifications.some((item) => !item.read_at);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Notifications</h1>
          <p className="mt-2 text-ink/75">New suggestions and automatic updates appear here. Email can be added later in one place in the code.</p>
        </div>
        {unread ? (
          <form action={markAllNotificationsRead}>
            <button type="submit" className="text-sm font-semibold text-white underline decoration-red">
              Mark all read
            </button>
          </form>
        ) : null}
      </div>

      {notifications.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-line bg-card px-5 py-8 text-ink/70">
          You are up to date. Approvers see a note here when a suggestion arrives.
        </p>
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
                  <Link href={item.link} className="text-white underline decoration-red">
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

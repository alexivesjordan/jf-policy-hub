import "server-only";

import { deliverEmailNotification } from "@/features/notifications/email";
import type { AgentResult } from "@/lib/types";

export async function dispatchNotificationEmails(result: AgentResult | null | undefined) {
  const notifications = result?.notifications;
  if (!notifications?.length) return;

  await Promise.all(
    notifications.map(async (item) => {
      if (!item.email || !item.title || !item.body) return;
      try {
        await deliverEmailNotification({
          toUserId: item.user_id ?? "",
          toEmail: item.email,
          title: item.title,
          body: item.body,
          link: item.link ?? null,
        });
      } catch (error) {
        console.error("Email notification hook failed", error);
      }
    }),
  );
}

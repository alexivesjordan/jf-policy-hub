import "server-only";

import { deliverPulseEmail } from "@/lib/email/deliver";

export type EmailNotification = {
  toUserId: string;
  toEmail: string;
  title: string;
  body: string;
  link: string | null;
};

/**
 * In-app notifications call this after the bell row is stored.
 * A mail failure must not undo the action that created the bell.
 */
export async function deliverEmailNotification(input: EmailNotification) {
  const link = input.link ? `\n${input.link}` : "";
  try {
    await deliverPulseEmail({
      to: input.toEmail,
      subject: input.title,
      template: "notification",
      text: `${input.body}${link}`,
      html: `<p>${input.body}</p>${input.link ? `<p><a href="${input.link}">${input.link}</a></p>` : ""}`,
    });
  } catch (error) {
    console.error("Email notification hook failed", error);
  }
}

import "server-only";

export type EmailNotification = {
  toUserId: string;
  toEmail: string;
  title: string;
  body: string;
  link: string | null;
};

/**
 * Email delivery hook.
 *
 * v1 only stores notifications in the app. Do not send mail from anywhere else.
 * When email is ready, implement it here (for example Resend). Callers already
 * pass the recipient, title, body, and link. This function must not throw:
 * a mail failure should not undo an approval or an upload.
 */
export async function deliverEmailNotification(input: EmailNotification) {
  void input;
}

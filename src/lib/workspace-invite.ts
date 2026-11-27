export type ResendState = { ok: boolean; message: string; nonce: string } | null;

export const INVITE_SENT = "Invite sent.";
export const INVITE_NOT_SENT = "The invite email was not sent. Try again in a moment.";
export const INVITE_NEEDS_KEY = "Sending the invite email needs SUPABASE_SERVICE_ROLE_KEY on the server.";
export const INVITE_ALREADY_SIGNED_IN = "They have already signed in.";
export const INVITE_NEEDS_EMAIL = "Enter an email address.";

export type InviteEmailSender = (
  email: string,
  options: { redirectTo: string },
) => Promise<{ error: { message: string } | null }>;

function result(ok: boolean, message: string): ResendState {
  return { ok, message, nonce: crypto.randomUUID() };
}

/** Sends one invite email. Does not change the person's role, teams, or access. */
export async function resendInviteEmail(input: {
  email: string;
  redirectTo: string;
  hasServiceRole: boolean;
  send: InviteEmailSender | null;
}): Promise<ResendState> {
  const email = input.email.trim();
  if (!email) return result(false, INVITE_NEEDS_EMAIL);
  if (!input.hasServiceRole || !input.send) return result(false, INVITE_NEEDS_KEY);
  try {
    const { error } = await input.send(email, { redirectTo: input.redirectTo });
    if (error) return result(false, INVITE_NOT_SENT);
  } catch {
    return result(false, INVITE_NOT_SENT);
  }
  return result(true, INVITE_SENT);
}

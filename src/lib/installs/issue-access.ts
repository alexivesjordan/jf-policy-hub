import "server-only";

import { deliverPulseEmail } from "@/lib/email/deliver";
import { closedInstallMessage } from "@/lib/installs/access-auth";
import { siteUrl } from "@/lib/site-url";
import { createTokenLink } from "@/lib/pulse/tokens";
import { createAdminClient } from "@/lib/supabase/admin";

export type AccessIssueResult = {
  sent: boolean;
  needsEmail: boolean;
  status: "logged" | "sent" | "failed" | "redirected";
  path: string | null;
};

const SUBJECT = "Site access for your Jordan Fitness install";

function accessUrl(path: string) {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function issueInstallAccess(
  install: { id: string; contactEmail?: string | null; endOn?: string | null },
  options: { rotate?: boolean } = {},
): Promise<AccessIssueResult> {
  const rotate = options.rotate !== false;
  const admin = createAdminClient();
  if (!admin) return { sent: false, needsEmail: !install.contactEmail, status: "logged", path: null };
  const closed = await refusedClosedInstall(admin, install.id);
  if (closed) return { sent: false, needsEmail: false, status: "failed", path: null };

  let tokenLinkId: string | null = null;
  let path: string | null = null;
  if (!rotate) {
    const existing = await admin.rpc("install_latest_access_path", { p_install: install.id });
    path = typeof existing.data === "string" && existing.data ? existing.data : null;
  }
  if (!path) {
    if (rotate) await admin.rpc("install_revoke_access_links", { p_install: install.id });
    const link = await createTokenLink({
      purpose: "access_form",
      entitySchema: "ops",
      entityTable: "installs",
      entityId: install.id,
      expiresAt: install.endOn ? `${install.endOn}T23:59:59.000Z` : null,
    });
    tokenLinkId = link.id;
    path = `/access/${link.token}`;
  }

  const email = install.contactEmail?.trim() ?? "";
  if (!email) {
    await admin.rpc("email_record", {
      p_to: "missing",
      p_subject: SUBJECT,
      p_template: "access_form",
      p_install: install.id,
      p_provider_id: null,
      p_status: "logged",
      p_detail: "No customer email",
      p_token_link: tokenLinkId,
      p_access_path: path,
    });
    await admin.rpc("install_mark_access_sent", { p_install: install.id, p_delivered: false, p_reason: "missing_email" });
    return { sent: false, needsEmail: true, status: "logged", path };
  }

  const url = accessUrl(path);
  const result = await deliverPulseEmail({
    to: email,
    subject: SUBJECT,
    template: "access_form",
    installId: install.id,
    tokenLinkId,
    accessPath: path,
    text: `Tell us about access for your install: ${url}`,
    html: `<p>Tell us about access for your install.</p><p><a href="${url}">${url}</a></p>`,
  });
  const delivered = result.status === "sent" || result.status === "redirected";
  await admin.rpc("install_mark_access_sent", {
    p_install: install.id,
    p_delivered: delivered,
    p_reason: delivered ? null : "not_delivered",
  });
  return { sent: delivered, needsEmail: !delivered && true, status: result.status, path };
}

/** Null when the install can still receive a link. A missing function does not block. */
export async function refusedClosedInstall(client: unknown, installId: string) {
  const gate = await (client as { rpc: (fn: string, args: { p_id: string }) => Promise<{ error: { message?: string } | null }> }).rpc("install_assert_linkable", { p_id: installId });
  if (!gate.error) return null;
  return closedInstallMessage(statusFromGate(gate.error.message));
}

function statusFromGate(message: string | undefined) {
  if (message?.includes("This install is cancelled.")) return "cancelled";
  if (message?.includes("This install is completed.")) return "completed";
  return null;
}

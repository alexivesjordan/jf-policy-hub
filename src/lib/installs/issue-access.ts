import "server-only";

import { deliverPulseEmail } from "@/lib/email/deliver";
import { siteUrl } from "@/lib/site-url";
import { createTokenLink } from "@/lib/pulse/tokens";
import { createAdminClient } from "@/lib/supabase/admin";

export async function issueInstallAccess(install: { id: string; contactEmail?: string | null; endOn?: string | null }) {
  const admin = createAdminClient();
  if (!admin) return { sent: false, needsEmail: !install.contactEmail };
  await admin.rpc("install_revoke_access_links", { p_install: install.id });
  const expiresAt = install.endOn ? `${install.endOn}T23:59:59.000Z` : null;
  const link = await createTokenLink({
    purpose: "access_form",
    entitySchema: "ops",
    entityTable: "installs",
    entityId: install.id,
    expiresAt,
  });
  const email = install.contactEmail?.trim() ?? "";
  if (!email) {
    await admin.rpc("install_mark_access_sent", { p_install: install.id, p_needs_email: true });
    return { sent: false, needsEmail: true };
  }
  const url = `${siteUrl()}/access/${link.token}`;
  await deliverPulseEmail({
    to: email,
    subject: "Site access for your Jordan Fitness install",
    template: "access_form",
    installId: install.id,
    text: `Tell us about access for your install: ${url}`,
    html: `<p>Tell us about access for your install.</p><p><a href="${url}">${url}</a></p>`,
  });
  await admin.rpc("install_mark_access_sent", { p_install: install.id, p_needs_email: false });
  return { sent: true, needsEmail: false };
}

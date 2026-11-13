import "server-only";

import { sendPulseEmail, type PulseEmail } from "@/lib/email/send";
import { createAdminClient } from "@/lib/supabase/admin";

export async function deliverPulseEmail(input: PulseEmail) {
  return sendPulseEmail(input, {
    env: process.env,
    fetch: globalThis.fetch,
    record: async (row) => {
      const admin = createAdminClient();
      if (!admin) return;
      await admin.rpc("email_record", {
        p_to: row.to,
        p_subject: row.subject,
        p_template: row.template,
        p_install: row.installId,
        p_provider_id: row.providerId,
        p_status: row.status,
        p_detail: row.detail,
        p_token_link: row.tokenLinkId,
        p_access_path: row.accessPath,
      });
    },
  });
}

import { connection } from "next/server";
import { issueInstallAccess } from "@/lib/installs/issue-access";
import { accessReminderDue, type AccessReminderCadence } from "@/lib/installs/reminders";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  await connection();
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  const header = request.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) {
    return Response.json({ error: "This reminder run is not authorised." }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) return Response.json({ error: "The service role key is not set." }, { status: 503 });

  const queued = await admin.rpc("install_access_reminder_queue");
  if (queued.error || !queued.data) {
    return Response.json({ error: "Could not read reminder candidates." }, { status: 502 });
  }
  const payload = queued.data as {
    settings?: { weekly?: boolean; finalDaysBeforeStart?: number; backfillMissingLinks?: boolean };
    installs?: {
      id: string;
      email: string;
      bookedOn: string;
      startOn: string;
      endOn: string;
      submitted: boolean;
      mediaCount: number;
      lastReminderOn: string | null;
    }[];
    backfill?: { id: string; email: string; endOn: string }[];
  };
  const cadence: AccessReminderCadence = {
    weekly: payload.settings?.weekly !== false,
    finalDaysBeforeStart: Number(payload.settings?.finalDaysBeforeStart ?? 7),
  };
  const today = new Date().toISOString().slice(0, 10);
  let issued = 0;
  if (payload.settings?.backfillMissingLinks !== false) {
    for (const install of payload.backfill ?? []) {
      await issueInstallAccess(
        { id: install.id, contactEmail: install.email, endOn: String(install.endOn).slice(0, 10) },
        { rotate: false },
      );
      issued += 1;
    }
  }
  let sent = 0;
  for (const install of payload.installs ?? []) {
    const due = accessReminderDue(
      {
        bookedOn: String(install.bookedOn).slice(0, 10),
        startOn: String(install.startOn).slice(0, 10),
        today,
        submitted: install.submitted,
        mediaCount: install.mediaCount,
        lastReminderOn: install.lastReminderOn ? String(install.lastReminderOn).slice(0, 10) : null,
      },
      cadence,
    );
    if (!due) continue;
    const result = await issueInstallAccess(
      { id: install.id, contactEmail: install.email, endOn: String(install.endOn).slice(0, 10) },
      { rotate: false },
    );
    if (result.status === "failed") continue;
    await admin.rpc("install_mark_reminder_sent", { p_install: install.id, p_day: today });
    sent += 1;
  }
  return Response.json({ sent, issued });
}

import { connection } from "next/server";
import { SubcontractorInstall } from "@/components/subcontractor-install";
import { loadAskAnother, readSubcontractorBoard } from "@/features/subcontractors/quote-actions";
import { moduleAllows } from "@/lib/access";
import type { Profile } from "@/lib/types";

export async function SubcontractorInstallSection({ profile, install }: { profile: Profile; install: Record<string, unknown> }) {
  await connection();
  const id = String(install.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const threads = await readSubcontractorBoard(id);
  const stage = String(install.stage ?? "");
  const name = typeof install.subcontractorName === "string" ? install.subcontractorName : null;
  const canEdit = moduleAllows(profile, "sales", "edit") || moduleAllows(profile, "operations", "edit");
  if (threads.length === 0 && stage !== "quoting" && !name) return null;
  const emailed = threads.filter((thread) => thread.status !== "failed").map((thread) => thread.subcontractorId);
  const followup = canEdit && stage === "quoting" ? await loadAskAnother(id, emailed) : null;
  return <SubcontractorInstall installId={id} stage={stage} subcontractorName={name} threads={threads} canAward={canEdit} followup={followup} />;
}

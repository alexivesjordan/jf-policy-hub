import { connection } from "next/server";
import { SubcontractorInstall } from "@/components/subcontractor-install";
import { readSubcontractorBoard } from "@/features/subcontractors/quote-actions";
import { moduleAllows } from "@/lib/access";
import type { Profile } from "@/lib/types";

export async function SubcontractorInstallSection({ profile, install }: { profile: Profile; install: Record<string, unknown> }) {
  await connection();
  const id = String(install.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const threads = await readSubcontractorBoard(id);
  const stage = String(install.stage ?? "");
  const name = typeof install.subcontractorName === "string" ? install.subcontractorName : null;
  if (threads.length === 0 && stage !== "quoting" && !name) return null;
  return <SubcontractorInstall installId={id} stage={stage} subcontractorName={name} threads={threads} canAward={moduleAllows(profile, "sales", "edit") || moduleAllows(profile, "operations", "edit")} />;
}

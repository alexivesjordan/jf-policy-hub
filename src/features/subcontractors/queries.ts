import "server-only";

import { messageFromError } from "@/lib/errors";
import type { InsuranceDoc, SubcontractorRecord, SubcontractorStatus } from "@/lib/subcontractors/capability";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const STATUSES = new Set(["active", "preferred", "on_hold", "inactive"]);

export function asSubcontractor(value: unknown): SubcontractorRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.name !== "string") return null;
  const status = String(row.status ?? "active");
  return {
    id: row.id,
    name: row.name,
    contactName: textOrNull(row.contactName),
    phone: textOrNull(row.phone),
    emails: stringList(row.emails),
    regions: stringList(row.regions),
    jobTypes: stringList(row.jobTypes),
    maxCrew: row.maxCrew == null || row.maxCrew === "" ? null : Number(row.maxCrew),
    status: (STATUSES.has(status) ? status : "active") as SubcontractorStatus,
    notes: textOrNull(row.notes),
    insurance: insuranceList(row.insurance),
  };
}

export async function listSubcontractorRecords() {
  const supabase = await createClient();
  const listed = await supabase.rpc("subcontractor_list");
  if (listed.error) throw new Error(messageFromError(listed.error, "Could not load subcontractors."));
  const rows = Array.isArray(listed.data) ? listed.data : [];
  const records = rows.map(asSubcontractor).filter((row): row is SubcontractorRecord => row != null);
  return signInsurance(records);
}

export async function signInsurance(records: SubcontractorRecord[]) {
  const admin = createAdminClient();
  if (!admin) return records;
  return Promise.all(records.map(async (record) => ({
    ...record,
    insurance: await Promise.all(record.insurance.map(async (doc) => {
      if (!doc.bucket || !doc.path) return doc;
      const signed = await admin.storage.from(doc.bucket).createSignedUrl(doc.path, 60 * 10);
      return { ...doc, url: signed.data?.signedUrl ?? null };
    })),
  })));
}

function textOrNull(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function insuranceList(value: unknown): InsuranceDoc[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.expiresOn !== "string") return [];
    return [{
      id: row.id,
      fileId: String(row.fileId ?? ""),
      expiresOn: row.expiresOn.slice(0, 10),
      label: textOrNull(row.label),
      bucket: textOrNull(row.bucket),
      path: textOrNull(row.path),
    }];
  });
}

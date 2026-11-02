/**
 * Read the attached PDF or Word file for a policy and fill an empty version.
 *
 * Requires the migration 20261030170000_fill_empty_policy_text.sql.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/backfill-policy-text.ts 1452efac-98ce-4129-9cd6-48ce93a62ec4
 */
import { createClient } from "@supabase/supabase-js";
import { detectDocument, documentToMarkdown } from "../src/features/policies/extract-text";

const policyId = process.argv[2] ?? "1452efac-98ce-4129-9cd6-48ce93a62ec4";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: policy, error: policyError } = await supabase
  .from("policies")
  .select("id, title, current_content, source_file_path, source_file_name")
  .eq("id", policyId)
  .maybeSingle();

if (policyError || !policy) {
  console.error(policyError?.message ?? "Policy not found.");
  process.exit(1);
}

if (!policy.source_file_path) {
  console.error(`${policy.title} has no attached file.`);
  process.exit(1);
}

const { data: file, error: downloadError } = await supabase.storage
  .from("policy-documents")
  .download(policy.source_file_path);

if (downloadError || !file) {
  console.error(downloadError?.message ?? "Could not download the file.");
  process.exit(1);
}

const bytes = new Uint8Array(await file.arrayBuffer());
const kind = detectDocument(policy.source_file_name || policy.source_file_path, bytes);
if (!kind) {
  console.error("The attached file is not a PDF or Word document.");
  process.exit(1);
}

const text = await documentToMarkdown(kind, bytes);
if (!text) {
  console.error("No text could be read. The file may be a scanned image.");
  process.exit(1);
}

const { data, error } = await supabase.rpc("fill_empty_policy_text", {
  p_policy_id: policyId,
  p_content: text,
});

if (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(`Filled ${policy.title} (${policyId}).`);
console.log(data);
console.log(text.slice(0, 500));

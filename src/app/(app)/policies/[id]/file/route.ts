import { connection } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  await connection();
  const profile = await getCurrentProfile();
  if (!profile?.is_active) return new Response("Unauthorised", { status: 401 });

  const { id } = await context.params;
  const supabase = await createClient();
  const { data: policy } = await supabase
    .from("policies")
    .select("source_file_path, source_file_name")
    .eq("id", id)
    .maybeSingle();

  if (!policy?.source_file_path) return new Response("No file stored for this policy.", { status: 404 });

  const { data, error } = await supabase.storage.from("policy-documents").download(policy.source_file_path);
  if (error || !data) return new Response("Could not download that file.", { status: 404 });

  const filename = String(policy.source_file_name || "policy").replace(/["\r\n]/g, "");
  const type = filename.toLowerCase().endsWith(".pdf")
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  return new Response(await data.arrayBuffer(), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

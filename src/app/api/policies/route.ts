import { connection } from "next/server";
import { researchAgentAuthorised } from "@/features/amendments/agent-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  await connection();

  if (!researchAgentAuthorised(request)) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return Response.json({ error: "Server is not configured." }, { status: 500 });
  }

  const { data, error } = await admin
    .from("policies")
    .select(
      "id, title, status, current_content, review_date, updated_at, category:categories ( name, slug )",
    )
    .eq("status", "active")
    .order("title");

  if (error) {
    console.error(error);
    return Response.json({ error: "Could not load policies." }, { status: 500 });
  }

  const policies = (data ?? []).map((row) => {
    const category = Array.isArray(row.category) ? row.category[0] : row.category;
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      category: category?.name ?? null,
      category_slug: category?.slug ?? null,
      content: row.current_content,
      review_date: row.review_date,
      updated_at: row.updated_at,
    };
  });

  return Response.json({ policies });
}

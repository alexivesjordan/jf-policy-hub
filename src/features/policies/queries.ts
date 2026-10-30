import "server-only";

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { asOne } from "@/lib/utils";
import type {
  AmendmentRecord,
  AuditEntry,
  Category,
  Person,
  PolicyRecord,
  PolicyStatus,
  PolicyVersion,
  Profile,
} from "@/lib/types";

const policySelect = `
  id, title, category_id, owner_id, status, review_date, current_content,
  source_file_path, source_file_name, created_by, created_at, updated_at,
  category:categories ( id, name, slug, auto_apply_allowed ),
  owner:profiles!owner_id ( id, full_name, email )
`;

type PolicyJoin = Omit<PolicyRecord, "category" | "owner"> & {
  category: PolicyRecord["category"] | NonNullable<PolicyRecord["category"]>[] | null;
  owner: Person | Person[] | null;
};

function mapPolicy(row: PolicyJoin): PolicyRecord {
  return {
    ...row,
    status: row.status as PolicyStatus,
    category: asOne(row.category),
    owner: asOne(row.owner),
  };
}

export async function listCategories() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, slug, auto_apply_allowed")
    .order("name");
  if (error) {
    console.error(error);
    throw new Error("Could not load categories");
  }
  return (data ?? []) as Category[];
}

export async function listPeople() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_active, created_at, updated_at")
    .order("email");
  if (error) {
    console.error(error);
    throw new Error("Could not load people");
  }
  return (data ?? []) as Profile[];
}

export async function listPolicies(filters: {
  q?: string;
  category?: string;
  status?: string;
  reviewBefore?: string;
}) {
  const supabase = await createClient();
  let query = supabase.from("policies").select(policySelect).order("title").limit(500);

  if (filters.status === "draft" || filters.status === "active" || filters.status === "archived") {
    query = query.eq("status", filters.status);
  }

  const term = (filters.q ?? "").replace(/[%_,.()]/g, " ").trim();
  if (term) {
    query = query.or(`title.ilike.%${term}%,current_content.ilike.%${term}%`);
  }

  if (filters.reviewBefore) {
    query = query.neq("status", "archived").not("review_date", "is", null).lte("review_date", filters.reviewBefore);
  }

  const { data, error } = await query;
  if (error) {
    console.error(error);
    throw new Error("Could not load policies");
  }

  let rows = ((data ?? []) as PolicyJoin[]).map(mapPolicy);
  if (filters.category) {
    rows = rows.filter((row) => row.category?.slug === filters.category);
  }
  return rows;
}

export async function getPolicy(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("policies").select(policySelect).eq("id", id).maybeSingle();
  if (error) {
    console.error(error);
    throw new Error("Could not load that policy");
  }
  if (!data) notFound();
  return mapPolicy(data as PolicyJoin);
}

export async function findPolicy(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("policies").select(policySelect).eq("id", id).maybeSingle();
  if (error || !data) return null;
  return mapPolicy(data as PolicyJoin);
}

export async function listVersions(policyId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("policy_versions")
    .select(
      `id, policy_id, version_number, content, author_id, change_summary, reason, legal_source,
       amendment_id, source_file_name, created_at,
       author:profiles!author_id ( full_name, email )`,
    )
    .eq("policy_id", policyId)
    .order("version_number", { ascending: false });

  if (error) {
    console.error(error);
    throw new Error("Could not load version history");
  }

  return ((data ?? []) as Array<PolicyVersion & { author: Person | Person[] | null }>).map((row) => ({
    ...row,
    author: asOne(row.author),
  }));
}

export async function listPolicyAudit(policyId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, action, created_at, details, actor:profiles!actor_id ( full_name, email )")
    .eq("policy_id", policyId)
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) {
    console.error(error);
    throw new Error("Could not load the activity log");
  }

  return ((data ?? []) as Array<AuditEntry & { actor: Person | Person[] | null }>).map((row) => ({
    id: row.id,
    action: row.action,
    created_at: row.created_at,
    details: (row.details ?? {}) as Record<string, unknown>,
    actor: asOne(row.actor),
  }));
}

export async function listRecentVersions() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("policy_versions")
    .select(
      `id, version_number, change_summary, created_at, policy_id,
       author:profiles!author_id ( full_name, email ),
       policy:policies!policy_id ( title )`,
    )
    .order("created_at", { ascending: false })
    .limit(8);

  if (error) {
    console.error(error);
    throw new Error("Could not load recent changes");
  }

  return ((data ?? []) as Array<{
    id: string;
    version_number: number;
    change_summary: string;
    created_at: string;
    policy_id: string;
    author: Person | Person[] | null;
    policy: { title: string } | { title: string }[] | null;
  }>).map((row) => ({
    ...row,
    author: asOne(row.author),
    policy: asOne(row.policy),
  }));
}

export async function dashboardCounts(reviewBefore: string) {
  const supabase = await createClient();
  const [pending, due, placeholders, unread] = await Promise.all([
    supabase.from("amendments").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase
      .from("policies")
      .select("id", { count: "exact", head: true })
      .neq("status", "archived")
      .not("review_date", "is", null)
      .lte("review_date", reviewBefore),
    supabase
      .from("policies")
      .select("id", { count: "exact", head: true })
      .eq("status", "draft")
      .eq("current_content", "")
      .is("source_file_path", null),
    supabase.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);

  for (const result of [pending, due, placeholders, unread]) {
    if (result.error) {
      console.error(result.error);
      throw new Error("Could not load the dashboard");
    }
  }

  return {
    pending: pending.count ?? 0,
    due: due.count ?? 0,
    placeholders: placeholders.count ?? 0,
    unread: unread.count ?? 0,
  };
}

export async function unreadCount(userId: string) {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) {
    console.error(error);
    return 0;
  }
  return count ?? 0;
}

export async function pendingCount() {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("amendments")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) {
    console.error(error);
    return 0;
  }
  return count ?? 0;
}

export async function listAmendments(status?: string) {
  const supabase = await createClient();
  let query = supabase
    .from("amendments")
    .select(
      `id, policy_id, summary, status, severity, created_by, created_at, jurisdiction, effective_date,
       policy:policies ( title )`,
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (status === "pending" || status === "approved" || status === "rejected" || status === "auto-applied") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    console.error(error);
    throw new Error("Could not load suggestions");
  }

  return ((data ?? []) as Array<AmendmentRecord & { policy: { title: string } | { title: string }[] | null }>).map(
    (row) => ({
      ...row,
      policy: asOne(row.policy),
    }),
  );
}

export async function getAmendment(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("amendments")
    .select(
      `*,
       policy:policies ( id, title, current_content, status ),
       creator:profiles!created_by_user_id ( id, full_name, email ),
       reviewer:profiles!reviewer_id ( id, full_name, email )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error(error);
    throw new Error("Could not load that suggestion");
  }
  if (!data) notFound();

  const row = data as AmendmentRecord & {
    policy: AmendmentRecord["policy"] | NonNullable<AmendmentRecord["policy"]>[] | null;
    creator: Person | Person[] | null;
    reviewer: Person | Person[] | null;
  };

  return {
    ...row,
    source_urls: row.source_urls ?? [],
    policy: asOne(row.policy),
    creator: asOne(row.creator),
    reviewer: asOne(row.reviewer),
  };
}

export async function listNotifications(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, title, body, kind, link, read_at, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error(error);
    throw new Error("Could not load notifications");
  }

  return (data ?? []) as import("@/lib/types").NotificationRecord[];
}

export type Role = "admin" | "approver" | "staff";
export type PolicyStatus = "draft" | "active" | "archived";
export type AmendmentStatus = "pending" | "approved" | "rejected" | "auto-applied";
export type Severity = "low" | "medium" | "high";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Category = {
  id: string;
  name: string;
  slug: string;
  auto_apply_allowed: boolean;
};

export type Person = {
  id: string;
  full_name: string | null;
  email: string;
};

export type PolicyRecord = {
  id: string;
  title: string;
  category_id: string;
  owner_id: string | null;
  status: PolicyStatus;
  review_date: string | null;
  current_content: string;
  source_file_path: string | null;
  source_file_name: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  category: Category | null;
  owner: Person | null;
};

export type PolicyVersion = {
  id: string;
  policy_id: string;
  version_number: number;
  content: string;
  author_id: string | null;
  change_summary: string;
  reason: string | null;
  legal_source: string | null;
  amendment_id: string | null;
  source_file_name: string | null;
  created_at: string;
  author: Person | null;
};

export type AmendmentRecord = {
  id: string;
  policy_id: string;
  proposed_content: string;
  summary: string;
  legal_change_description: string | null;
  source_urls: string[];
  jurisdiction: string | null;
  effective_date: string | null;
  severity: Severity;
  created_by: "research agent" | "user";
  created_by_user_id: string | null;
  status: AmendmentStatus;
  reviewer_id: string | null;
  review_comment: string | null;
  reviewed_at: string | null;
  created_at: string;
  policy?: { id: string; title: string; current_content?: string; status?: PolicyStatus } | null;
  creator?: Person | null;
  reviewer?: Person | null;
};

export type AuditEntry = {
  id: string;
  action: string;
  created_at: string;
  details: Record<string, unknown>;
  actor: Person | null;
};

export type NotificationRecord = {
  id: string;
  title: string;
  body: string;
  kind: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export type AgentResult = {
  id: string;
  status: AmendmentStatus;
  policy_id?: string;
  notifications?: Array<{
    user_id?: string;
    email?: string;
    title?: string;
    body?: string;
    link?: string | null;
  }>;
};

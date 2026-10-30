"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dispatchNotificationEmails } from "@/features/notifications/dispatch";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import { messageFromError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { AgentResult, Severity } from "@/lib/types";

function clean(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

export async function suggestAmendment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const policyId = clean(formData.get("policyId"));
  const severity = clean(formData.get("severity"));
  if (severity !== "low" && severity !== "medium" && severity !== "high") {
    return { ok: false, message: "Choose how urgent this suggestion is." };
  }

  const links = clean(formData.get("sourceUrls"))
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const effective = clean(formData.get("effectiveDate"));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_amendment", {
    p_policy_id: policyId,
    p_proposed_content: typeof formData.get("content") === "string" ? String(formData.get("content")) : "",
    p_summary: clean(formData.get("summary")),
    p_legal_change_description: clean(formData.get("legalChange")),
    p_source_urls: links,
    p_jurisdiction: clean(formData.get("jurisdiction")),
    p_effective_date: /^\d{4}-\d{2}-\d{2}$/.test(effective) ? effective : null,
    p_severity: severity as Severity,
  });

  if (error || !data) {
    return { ok: false, message: messageFromError(error, "We could not save that suggestion.") };
  }

  const result = data as AgentResult;
  await dispatchNotificationEmails(result);
  revalidatePath("/amendments");
  revalidatePath("/dashboard");
  revalidatePath("/notifications");
  revalidatePath(`/policies/${policyId}`);

  if (result.status === "auto-applied") {
    redirect(`/policies/${result.policy_id ?? policyId}?uploaded=auto`);
  }

  redirect(`/amendments/${result.id}`);
}

export async function reviewAmendment(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const id = clean(formData.get("amendmentId"));
  const decision = clean(formData.get("decision"));
  if (decision !== "approved" && decision !== "rejected") {
    return { ok: false, message: "Choose approve or reject." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("review_amendment", {
    p_amendment_id: id,
    p_decision: decision,
    p_comment: clean(formData.get("comment")),
    p_edited_content: decision === "approved" ? String(formData.get("editedContent") ?? "") : null,
  });

  if (error || !data) {
    return { ok: false, message: messageFromError(error, "We could not save that decision.") };
  }

  const result = data as AgentResult;
  await dispatchNotificationEmails(result);
  revalidatePath("/amendments");
  revalidatePath(`/amendments/${id}`);
  revalidatePath("/dashboard");
  revalidatePath("/notifications");
  if (result.policy_id) {
    revalidatePath(`/policies/${result.policy_id}`);
    revalidatePath(`/policies/${result.policy_id}/history`);
  }
  redirect(`/amendments/${id}?done=1`);
}

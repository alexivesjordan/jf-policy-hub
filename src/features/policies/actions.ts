"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import { messageFromError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { safeFileName } from "@/lib/utils";
import type { PolicyStatus } from "@/lib/types";
import { detectDocument, documentToMarkdown } from "@/features/policies/extract-text";

const MAX_BYTES = 10 * 1024 * 1024;

function clean(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

async function savePolicy(input: {
  policyId: string | null;
  isNew: boolean;
  title: string;
  categoryId: string;
  status: PolicyStatus;
  reviewDate: string | null;
  ownerId: string | null;
  content: string;
  changeSummary: string;
  reason: string;
  legalSource: string;
  sourceFilePath: string | null;
  sourceFileName: string | null;
  replaceSourceFile: boolean;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_policy", {
    p_policy_id: input.policyId,
    p_is_new: input.isNew,
    p_title: input.title,
    p_category_id: input.categoryId,
    p_status: input.status,
    p_review_date: input.reviewDate,
    p_owner_id: input.ownerId,
    p_content: input.content,
    p_change_summary: input.changeSummary,
    p_reason: input.reason,
    p_legal_source: input.legalSource,
    p_source_file_path: input.sourceFilePath,
    p_source_file_name: input.sourceFileName,
    p_replace_source_file: input.replaceSourceFile,
  });

  if (error || !data) {
    return { ok: false as const, message: messageFromError(error, "We could not save that policy.") };
  }

  return { ok: true as const, id: data as string };
}

export async function savePolicyForm(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const policyId = clean(formData.get("policyId"));
  const isNew = !policyId;
  const status = clean(formData.get("status"));
  if (status !== "draft" && status !== "active" && status !== "archived") {
    return { ok: false, message: "Choose draft, active, or archived." };
  }

  const result = await savePolicy({
    policyId: policyId || null,
    isNew,
    title: clean(formData.get("title")),
    categoryId: clean(formData.get("categoryId")),
    status,
    reviewDate: optionalDate(clean(formData.get("reviewDate"))),
    ownerId: clean(formData.get("ownerId")) || null,
    content: typeof formData.get("content") === "string" ? String(formData.get("content")) : "",
    changeSummary: clean(formData.get("changeSummary")),
    reason: clean(formData.get("reason")),
    legalSource: clean(formData.get("legalSource")),
    sourceFilePath: null,
    sourceFileName: null,
    replaceSourceFile: false,
  });

  if (!result.ok) return result;

  refreshPolicy(result.id);
  redirect(`/policies/${result.id}`);
}

function refreshPolicy(id: string) {
  revalidatePath("/dashboard");
  revalidatePath("/policies");
  revalidatePath("/policies/upload");
  revalidatePath(`/policies/${id}`);
  revalidatePath(`/policies/${id}/history`);
}

export async function uploadPolicyDocument(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Please choose a Word (.docx) or PDF file." };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, message: "That file is larger than 10 MB. Try a smaller file." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detectDocument(file.name, bytes);
  if (!kind) {
    return {
      ok: false,
      message: "Please upload a .docx or .pdf file. Older .doc files need to be saved as .docx first.",
    };
  }

  const supabase = await createClient();
  const existingId = clean(formData.get("policyId"));
  const isNew = existingId === "" || existingId === "__new__";
  let title = clean(formData.get("title"));
  let categoryId = clean(formData.get("categoryId"));
  let status: PolicyStatus = formData.get("publish") === "yes" ? "active" : "draft";
  let reviewDate: string | null = null;
  let ownerId: string | null = user.id;
  let content = "";
  let policyId = isNew ? crypto.randomUUID() : existingId;

  if (!isNew) {
    const { data, error } = await supabase
      .from("policies")
      .select("id, title, category_id, status, review_date, owner_id, current_content")
      .eq("id", existingId)
      .maybeSingle();

    if (error || !data) {
      return { ok: false, message: "That policy could not be found." };
    }

    const existing = data as {
      id: string;
      title: string;
      category_id: string;
      status: PolicyStatus;
      review_date: string | null;
      owner_id: string | null;
      current_content: string;
    };

    if (existing.current_content.trim() && formData.get("confirmReplace") !== "yes") {
      return {
        ok: false,
        message: "This policy already has text. Tick the box to replace it with the text from this file.",
      };
    }

    title = existing.title;
    categoryId = existing.category_id;
    status = formData.get("publish") === "yes" ? "active" : existing.status;
    reviewDate = existing.review_date;
    ownerId = existing.owner_id ?? user.id;
    content = existing.current_content;
    policyId = existing.id;
  } else if (!title || !categoryId) {
    return { ok: false, message: "Add a title and category for the new policy." };
  }

  try {
    const extracted = await documentToMarkdown(kind, bytes);
    if (!extracted) {
      return {
        ok: false,
        message: "We could not find any text in that file. If it is a scanned PDF, paste the text with Edit text instead.",
      };
    }
    content = extracted;
  } catch (error) {
    console.error(error);
    return { ok: false, message: "We could not read that file. Try a .docx or a text-based PDF." };
  }

  const storedName = safeFileName(file.name);
  const path = `${policyId}/${Date.now()}-${storedName}`;
  const { error: uploadError } = await supabase.storage.from("policy-documents").upload(path, bytes, {
    contentType:
      kind === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: false,
  });

  if (uploadError) {
    console.error(uploadError);
    return { ok: false, message: "We could not store that file. Please try again." };
  }

  const note = clean(formData.get("note"));
  const summary = note || (kind === "docx" ? `Uploaded Word document: ${file.name}` : `Uploaded PDF: ${file.name}`);

  const result = await savePolicy({
    policyId,
    isNew,
    title,
    categoryId,
    status,
    reviewDate,
    ownerId,
    content,
    changeSummary: summary,
    reason: "",
    legalSource: "",
    sourceFilePath: path,
    sourceFileName: file.name.slice(0, 180),
    replaceSourceFile: true,
  });

  if (!result.ok) {
    await supabase.storage.from("policy-documents").remove([path]);
    return result;
  }

  refreshPolicy(result.id);
  redirect(`/policies/${result.id}?uploaded=${kind}`);
}

export async function readAttachedText(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const policyId = clean(formData.get("policyId"));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("policies")
    .select("id, title, category_id, status, review_date, owner_id, current_content, source_file_path, source_file_name")
    .eq("id", policyId)
    .maybeSingle();

  if (error || !data?.source_file_path) {
    return { ok: false, message: "That policy has no file to read." };
  }

  const policy = data as {
    id: string;
    title: string;
    category_id: string;
    status: PolicyStatus;
    review_date: string | null;
    owner_id: string | null;
    current_content: string;
    source_file_path: string;
    source_file_name: string | null;
  };

  const downloaded = await supabase.storage.from("policy-documents").download(policy.source_file_path);
  if (downloaded.error || !downloaded.data) {
    return { ok: false, message: "We could not open the attached file." };
  }

  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const kind = detectDocument(policy.source_file_name || policy.source_file_path, bytes);
  if (!kind) {
    return { ok: false, message: "The attached file is not a PDF or Word document." };
  }

  let text = "";
  try {
    text = await documentToMarkdown(kind, bytes);
  } catch (readError) {
    console.error(readError);
    return { ok: false, message: "We could not read that file." };
  }
  if (!text) {
    return { ok: false, message: "No text could be read. The file may be a scanned image." };
  }

  if (!policy.current_content.trim()) {
    const filled = await supabase.rpc("fill_empty_policy_text", {
      p_policy_id: policy.id,
      p_content: text,
    });
    if (filled.error) {
      return { ok: false, message: messageFromError(filled.error, "We could not save the text from that file.") };
    }
    refreshPolicy(policy.id);
    redirect(`/policies/${policy.id}?uploaded=${kind}`);
  }

  const result = await savePolicy({
    policyId: policy.id,
    isNew: false,
    title: policy.title,
    categoryId: policy.category_id,
    status: policy.status,
    reviewDate: policy.review_date,
    ownerId: policy.owner_id,
    content: text,
    changeSummary: "Read the text from the attached file again",
    reason: "",
    legalSource: "",
    sourceFilePath: null,
    sourceFileName: null,
    replaceSourceFile: false,
  });
  if (!result.ok) return result;
  refreshPolicy(policy.id);
  redirect(`/policies/${policy.id}?uploaded=${kind}`);
}

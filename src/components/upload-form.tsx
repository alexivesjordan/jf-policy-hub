"use client";

import { useActionState, useMemo, useState } from "react";
import { readAttachedText, uploadPolicyDocument } from "@/features/policies/actions";
import { Banner, Button, Field, Input, Select } from "@/components/ui";
import { statusLabel } from "@/lib/format";

type PolicyOption = {
  id: string;
  title: string;
  categoryName: string;
  status: string;
  needsDocument: boolean;
  hasFile: boolean;
  hasContent: boolean;
};

export function UploadForm({
  policies,
  categories,
  initialPolicyId,
  locked,
}: {
  policies: PolicyOption[];
  categories: { id: string; name: string }[];
  initialPolicyId?: string;
  locked?: { id: string; title: string; hasContent: boolean };
}) {
  const [state, action, pending] = useActionState(uploadPolicyDocument, null);
  const [policyId, setPolicyId] = useState(locked?.id ?? initialPolicyId ?? "");
  const [filter, setFilter] = useState("");
  const selected = locked ?? policies.find((policy) => policy.id === policyId);
  const isNew = !locked && policyId === "__new__";
  const hasContent = Boolean(selected && "hasContent" in selected && selected.hasContent);
  const visiblePolicies = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const matched = query
      ? policies.filter((policy) => `${policy.title} ${policy.categoryName} ${policy.status}`.toLowerCase().includes(query))
      : policies;
    if (selected && "id" in selected && !matched.some((policy) => policy.id === selected.id)) {
      const current = policies.find((policy) => policy.id === selected.id);
      return current ? [current, ...matched] : matched;
    }
    return matched;
  }, [filter, policies, selected]);

  return (
    <form action={action} className="space-y-5">
      {state?.ok === false ? <Banner tone="error">{state.message}</Banner> : null}

      {locked ? (
        <input type="hidden" name="policyId" value={locked.id} />
      ) : (
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">Which policy is this?</legend>
          <p className="text-sm text-grey">Every draft and active policy is listed, including ones that already have a file.</p>
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search by title, for example Modern Slavery"
            aria-label="Search policies"
          />
          <div className="max-h-80 space-y-2 overflow-auto rounded-2xl border border-line p-2">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 hover:bg-white/5">
              <input
                type="radio"
                name="policyId"
                value="__new__"
                checked={policyId === "__new__"}
                onChange={() => setPolicyId("__new__")}
                required
              />
              <span className="font-semibold">Create a new policy</span>
            </label>
            {visiblePolicies.map((policy) => (
              <label
                key={policy.id}
                className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border px-3 py-2 ${policyId === policy.id ? "border-red bg-red/10" : "border-transparent hover:bg-white/5"}`}
              >
                <input
                  type="radio"
                  name="policyId"
                  value={policy.id}
                  checked={policyId === policy.id}
                  onChange={() => setPolicyId(policy.id)}
                  className="mt-1"
                  required
                />
                <span>
                  <span className="block font-semibold">{policy.title}</span>
                  <span className="block text-sm text-grey">{optionLabel(policy)}</span>
                </span>
              </label>
            ))}
            {visiblePolicies.length === 0 ? <p className="px-3 py-2 text-sm text-grey">No policies match that search.</p> : null}
          </div>
        </fieldset>
      )}

      {isNew ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Title">
            <Input name="title" required placeholder="For example, Hybrid Working" />
          </Field>
          <Field label="Category">
            <Select name="categoryId" required defaultValue="">
              <option value="" disabled>
                Choose a category
              </option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : null}

      <Field
        label="Word or PDF file"
        hint="Word and PDF files are read into the policy text. The original file stays attached."
      >
        <Input name="file" type="file" required accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
      </Field>

      {hasContent ? (
        <label className="flex items-start gap-3 rounded-2xl border border-line bg-card px-3 py-3 text-sm text-white">
          <input type="checkbox" name="confirmReplace" value="yes" className="mt-1" />
          <span>Replace the current policy text with the text from this file.</span>
        </label>
      ) : null}

      <Field label="Note about this upload" hint="Optional. If you leave this blank, we record the file name.">
        <Input name="note" placeholder="For example, 2026 version from HR" />
      </Field>

      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="publish" value="yes" className="mt-1" />
        <span>This is ready for people to follow. Leave unticked to keep it as a draft while you check it.</span>
      </label>

      <Button type="submit" disabled={pending}>
        {pending ? "Uploading..." : "Upload and save"}
      </Button>
    </form>
  );
}

function optionLabel(policy: PolicyOption) {
  const file = policy.hasFile ? "has a file" : "no file yet";
  return `${policy.categoryName} · ${statusLabel(policy.status)} · ${file}`;
}

export function ReadAttachedTextForm({ policyId }: { policyId: string }) {
  const [state, action, pending] = useActionState(readAttachedText, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="policyId" value={policyId} />
      {state?.ok === false ? <Banner tone="error">{state.message}</Banner> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Reading the file..." : "Read text from the attached file"}
      </Button>
    </form>
  );
}

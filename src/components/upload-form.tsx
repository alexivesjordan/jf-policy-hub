"use client";

import { useActionState, useState } from "react";
import { uploadPolicyDocument } from "@/features/policies/actions";
import { Banner, Button, Field, Input, Select } from "@/components/ui";

type PolicyOption = {
  id: string;
  title: string;
  categoryName: string;
  needsDocument: boolean;
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
  const selected = locked ?? policies.find((policy) => policy.id === policyId);
  const isNew = !locked && policyId === "__new__";
  const hasContent = Boolean(selected && "hasContent" in selected && selected.hasContent);

  return (
    <form action={action} className="space-y-5">
      {state?.ok === false ? <Banner tone="error">{state.message}</Banner> : null}

      {locked ? (
        <input type="hidden" name="policyId" value={locked.id} />
      ) : (
        <Field label="Which policy is this?" hint="Choose a placeholder, or start a new policy.">
          <Select name="policyId" value={policyId} onChange={(event) => setPolicyId(event.target.value)} required>
            <option value="">Choose a policy</option>
            <option value="__new__">Create a new policy</option>
            {policies.map((policy) => (
              <option key={policy.id} value={policy.id}>
                {policy.needsDocument ? `${policy.title} (needs a document)` : `${policy.title} — ${policy.categoryName}`}
              </option>
            ))}
          </Select>
        </Field>
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
        hint="Word files are read into the policy so you can edit the text. PDFs are stored with the policy as the original file."
      >
        <Input name="file" type="file" required accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
      </Field>

      {hasContent ? (
        <label className="flex items-start gap-3 rounded-2xl border border-line bg-card px-3 py-3 text-sm text-white">
          <input type="checkbox" name="confirmReplace" value="yes" className="mt-1" />
          <span>Replace the current policy text with the text from this Word document. Leave this unticked if you are only adding a PDF.</span>
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

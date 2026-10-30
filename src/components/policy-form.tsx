"use client";

import { useActionState } from "react";
import { savePolicyForm } from "@/features/policies/actions";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Banner, Button, Field, Input, Select } from "@/components/ui";
import type { Category, Person, PolicyRecord } from "@/lib/types";

export function PolicyForm({
  policy,
  categories,
  people,
}: {
  policy?: PolicyRecord;
  categories: Category[];
  people: Person[];
}) {
  const [state, action, pending] = useActionState(savePolicyForm, null);

  return (
    <form action={action} className="space-y-5">
      {state?.ok === false ? <Banner tone="error">{state.message}</Banner> : null}
      {policy ? <input type="hidden" name="policyId" value={policy.id} /> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Title">
          <Input name="title" required defaultValue={policy?.title ?? ""} />
        </Field>
        <Field label="Category">
          <Select name="categoryId" required defaultValue={policy?.category_id ?? ""}>
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
        <Field label="Status" hint="Draft while you prepare it. Active when people should follow it.">
          <Select name="status" defaultValue={policy?.status ?? "draft"}>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </Select>
        </Field>
        <Field label="Review date" hint="Optional. We will remind you when it is due.">
          <Input name="reviewDate" type="date" defaultValue={policy?.review_date ?? ""} />
        </Field>
        <Field label="Owner">
          <Select name="ownerId" defaultValue={policy?.owner_id ?? ""}>
            <option value="">Unassigned</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.full_name || person.email}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Policy text">
        <MarkdownEditor name="content" defaultValue={policy?.current_content ?? ""} />
      </Field>

      <Field label="What changed?" hint="This is saved with the version, so keep it short and plain.">
        <Input name="changeSummary" required placeholder="For example, Added the 2026 annual leave table" />
      </Field>
      <Field label="Why was this change made?" hint="Optional.">
        <Input name="reason" />
      </Field>
      <Field label="Legal source" hint="Optional. A law, code, or guidance note this change follows.">
        <Input name="legalSource" />
      </Field>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save new version"}
      </Button>
    </form>
  );
}

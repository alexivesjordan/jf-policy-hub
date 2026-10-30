"use client";

import { useActionState } from "react";
import { suggestAmendment } from "@/features/amendments/actions";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Banner, Button, Field, Input, Select, TextArea } from "@/components/ui";

export function SuggestForm({ policyId, content }: { policyId: string; content: string }) {
  const [state, action, pending] = useActionState(suggestAmendment, null);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="policyId" value={policyId} />
      {state?.ok === false ? <Banner tone="error">{state.message}</Banner> : null}
      <Field label="Summary" hint="One or two sentences an approver can read first.">
        <Input name="summary" required />
      </Field>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="How urgent is this?">
          <Select name="severity" defaultValue="medium">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </Select>
        </Field>
        <Field label="Jurisdiction" hint="Optional.">
          <Input name="jurisdiction" placeholder="England and Wales" />
        </Field>
        <Field label="Effective date" hint="Optional.">
          <Input name="effectiveDate" type="date" />
        </Field>
      </div>
      <Field label="What the law or guidance changed" hint="Optional, but helpful for the approver.">
        <TextArea name="legalChange" />
      </Field>
      <Field label="Source links" hint="Optional. One link per line.">
        <TextArea name="sourceUrls" className="min-h-24" />
      </Field>
      <Field label="Suggested policy text">
        <MarkdownEditor name="content" defaultValue={content} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Sending..." : "Send for review"}
      </Button>
    </form>
  );
}

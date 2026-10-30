"use client";

import { useActionState, useState } from "react";
import { reviewAmendment } from "@/features/amendments/actions";
import { Banner, Button, Field, TextArea } from "@/components/ui";

export function ReviewForm({ amendmentId, proposed }: { amendmentId: string; proposed: string }) {
  const [state, action, pending] = useActionState(reviewAmendment, null);
  const [text, setText] = useState(proposed);
  const edited = text !== proposed;

  return (
    <div className="space-y-8">
      <form action={action} className="space-y-4">
        <input type="hidden" name="amendmentId" value={amendmentId} />
        <input type="hidden" name="decision" value="approved" />
        <Field
          label="Policy text to approve"
          hint="Change the wording here if you want to edit it before it becomes the new version."
        >
          <TextArea name="editedContent" value={text} onChange={(event) => setText(event.target.value)} className="min-h-64 font-sans" />
        </Field>
        <Field label="Note for the record" hint="Optional when you approve.">
          <TextArea name="comment" className="min-h-24" />
        </Field>
        {state?.ok === false ? <Banner tone="error">{state.message}</Banner> : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : edited ? "Save edits and approve" : "Approve this suggestion"}
        </Button>
      </form>

      <RejectForm amendmentId={amendmentId} />
    </div>
  );
}

function RejectForm({ amendmentId }: { amendmentId: string }) {
  const [state, action, pending] = useActionState(reviewAmendment, null);

  return (
    <form action={action} className="space-y-4 border-t border-line pt-6">
      <input type="hidden" name="amendmentId" value={amendmentId} />
      <input type="hidden" name="decision" value="rejected" />
      <Field label="Reject this suggestion" hint="A comment is required so the reason is on record.">
        <TextArea name="comment" required className="min-h-24" />
      </Field>
      {state?.ok === false ? <Banner tone="error">{state.message}</Banner> : null}
      <Button type="submit" variant="danger" disabled={pending}>
        {pending ? "Saving..." : "Reject with this comment"}
      </Button>
    </form>
  );
}

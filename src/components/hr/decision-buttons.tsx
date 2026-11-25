"use client";

import { useActionState } from "react";
import { Button } from "@/components/pulse/ui";
import { FormStatus } from "@/components/hr/form-status";
import { decideChange, decideLeave } from "@/features/hr/actions";

export function DecisionButtons({ id, kind }: { id: string; kind: "leave" | "change" }) {
  const action = kind === "leave" ? decideLeave : decideChange;
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" name="intent" value="approve" disabled={pending}>{pending ? "Saving…" : "Approve"}</Button>
      <Button type="submit" name="intent" value="reject" variant="secondary" disabled={pending}>{pending ? "Saving…" : "Reject"}</Button>
      <FormStatus state={state} />
    </form>
  );
}

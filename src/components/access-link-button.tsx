"use client";

import { useActionState } from "react";
import { Banner, Button } from "@/components/ui";
import { createAccessLink } from "@/features/operations/access-actions";

export function AccessLinkButton({ jobId }: { jobId: string }) {
  const [state, action, pending] = useActionState(createAccessLink, null);
  const path = (state as { path?: string } | null)?.path;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="jobId" value={jobId} />
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Creating..." : "Create access link"}
      </Button>
      {state ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
      {path ? <p className="break-all text-sm text-white">{path}</p> : null}
    </form>
  );
}

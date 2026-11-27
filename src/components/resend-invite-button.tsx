"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { resendWorkspaceInvite } from "@/features/workspace/actions";
import { Button } from "@/components/pulse/ui";
import type { ResendState } from "@/lib/workspace-invite";

const announced = new Set<string>();

export function ResendInviteButton({ email, name }: { email: string; name?: string }) {
  const [state, action, pending] = useActionState(resendWorkspaceInvite, null as ResendState);
  useEffect(() => {
    if (!state || announced.has(state.nonce)) return;
    announced.add(state.nonce);
    if (state.ok) toast.success(state.message);
    else toast.error(state.message);
  }, [state]);
  return (
    <form action={action}>
      <input type="hidden" name="email" value={email} />
      <Button
        type="submit"
        variant="secondary"
        className="min-h-11 font-sans"
        disabled={pending}
        aria-busy={pending}
        aria-label={name ? `Resend invite to ${name}` : "Resend invite"}
      >
        Resend invite
      </Button>
    </form>
  );
}

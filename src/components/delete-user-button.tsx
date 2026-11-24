"use client";

import { useActionState } from "react";
import { deleteWorkspaceUser } from "@/features/workspace/actions";
import { Button } from "@/components/pulse/ui";

export function DeleteUserButton({ userId, name }: { userId: string; name: string }) {
  const [state, action, pending] = useActionState(deleteWorkspaceUser, null);
  return (
    <form
      action={action}
      className="space-y-2"
      onSubmit={(event) => {
        if (!window.confirm(`Delete ${name}? They will not be able to sign in.`)) event.preventDefault();
      }}
    >
      <input type="hidden" name="userId" value={userId} />
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Deleting" : "Delete user"}</Button>
      {state?.message ? <p className="text-sm font-semibold text-red">{state.message}</p> : null}
    </form>
  );
}

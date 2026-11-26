"use client";

import { resendWorkspaceInvite, revokeWorkspaceInvite } from "@/features/workspace/actions";
import { Button } from "@/components/pulse/ui";

export function PendingInvites({ invites }: { invites: { email: string; full_name: string | null; role: string }[] }) {
  if (invites.length === 0) return null;
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">Invites</h2>
      <ul className="space-y-2">
        {invites.map((invite) => {
          const name = invite.full_name || invite.email;
          return (
            <li key={invite.email} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-card px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{name}</span>
                <span className="block text-sm text-grey">{invite.email}</span>
              </span>
              <form action={resendWorkspaceInvite}>
                <input type="hidden" name="email" value={invite.email} />
                <Button type="submit" variant="secondary" className="min-h-11">Resend</Button>
              </form>
              <form
                action={revokeWorkspaceInvite}
                onSubmit={(event) => {
                  if (!window.confirm(`Revoke the invite for ${name}?`)) event.preventDefault();
                }}
              >
                <input type="hidden" name="email" value={invite.email} />
                <Button type="submit" variant="danger" className="min-h-11">Revoke</Button>
              </form>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

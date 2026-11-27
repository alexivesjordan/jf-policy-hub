"use client";

import { revokeWorkspaceInvite } from "@/features/workspace/actions";
import { ResendInviteButton } from "@/components/resend-invite-button";
import { Button } from "@/components/pulse/ui";
import type { WorkspaceInviteRow } from "@/lib/members";

export function PendingInvites({ invites }: { invites: WorkspaceInviteRow[] }) {
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
              <ResendInviteButton email={invite.email} name={name} />
              {invite.revocable ? (
                <form
                  action={revokeWorkspaceInvite}
                  onSubmit={(event) => {
                    if (!window.confirm(`Revoke the invite for ${name}?`)) event.preventDefault();
                  }}
                >
                  <input type="hidden" name="email" value={invite.email} />
                  <Button type="submit" variant="danger" className="min-h-11">Revoke</Button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

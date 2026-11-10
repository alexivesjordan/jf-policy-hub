"use client";

import Link from "next/link";
import { signOut } from "@/features/auth/actions";
import { canManageWorkspace } from "@/lib/access";
import { roleLabel } from "@/lib/format";

function accessLabel(profile: Profile) {
  const role = profile.workspace_role;
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  if (role === "manager") return "Manager";
  if (role === "member") return "Member";
  if (role === "viewer") return "Viewer";
  return roleLabel(profile.role);
}
import type { Profile } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({
  profile,
  placement = "down",
  className,
}: {
  profile: Profile;
  placement?: "down" | "up";
  className?: string;
}) {
  const name = profile.full_name || profile.email;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn("w-full rounded-2xl px-3 py-2 text-left hover:bg-ink/5", className)}>
        <span className="block truncate text-sm font-semibold text-ink">{name}</span>
        <span className="block truncate text-sm text-grey">{accessLabel(profile)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={placement === "up" ? "top" : "bottom"} className="w-64">
        <DropdownMenuLabel className="truncate font-normal text-grey">{profile.email}</DropdownMenuLabel>
        {canManageWorkspace(profile) ? (
          <DropdownMenuItem render={<Link href="/workspace" />}>Workspace</DropdownMenuItem>
        ) : null}
        <DropdownMenuItem render={<Link href="/account/password" />}>Change password</DropdownMenuItem>
        <form action={signOut}>
          <DropdownMenuItem nativeButton render={<button type="submit" className="w-full text-left" />}>
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

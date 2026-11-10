"use client";

import Link from "next/link";
import { signOut } from "@/features/auth/actions";
import { roleLabel } from "@/lib/format";
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
        <span className="block truncate text-sm text-grey">{roleLabel(profile.role)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={placement === "up" ? "top" : "bottom"} className="w-64">
        <DropdownMenuLabel className="truncate font-normal text-grey">{profile.email}</DropdownMenuLabel>
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

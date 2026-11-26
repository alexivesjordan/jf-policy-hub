"use client";

import Link from "next/link";
import { signOut } from "@/features/auth/actions";
import { accountMenuItems } from "@/lib/settings-nav";
import type { Profile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu({
  profile,
  placement = "down",
  fieldEngineer = false,
  className,
}: {
  profile: Profile;
  placement?: "down" | "up";
  fieldEngineer?: boolean;
  className?: string;
}) {
  const name = profile.full_name || profile.email;
  const items = accountMenuItems(fieldEngineer);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn("w-full rounded-2xl px-3 py-2 text-left outline-none hover:bg-ink/5 focus-visible:ring-3 focus-visible:ring-ring/50", className)}>
        <span className="block truncate text-sm font-semibold text-ink">{name}</span>
        <span className="block truncate text-sm text-grey">{profile.email}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side={placement === "up" ? "top" : "bottom"} className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate font-normal text-grey">{profile.email}</DropdownMenuLabel>
        </DropdownMenuGroup>
        {items.map((item) => (
          <DropdownMenuItem key={item.href} render={<Link href={item.href} className="min-h-11" />}>
            {item.label}
          </DropdownMenuItem>
        ))}
        <div className="flex min-h-11 items-center justify-between px-2">
          <span className="text-sm font-semibold">Theme</span>
          <ThemeToggle />
        </div>
        <form action={signOut}>
          <DropdownMenuItem nativeButton render={<button type="submit" className="min-h-11 w-full text-left" />}>
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { signOut } from "@/features/auth/actions";
import { roleLabel } from "@/lib/format";
import type { Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

export function UserMenu({
  profile,
  placement = "down",
  className,
}: {
  profile: Profile;
  placement?: "down" | "up";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const name = profile.full_name || profile.email;

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className="w-full rounded-2xl px-3 py-2 text-left hover:bg-white/10"
      >
        <span className="block truncate text-sm font-semibold text-white">{name}</span>
        <span className="block truncate text-sm text-grey">{roleLabel(profile.role)}</span>
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className={cn(
            "absolute z-20 w-64 rounded-2xl border border-line bg-card p-2 shadow-[0_16px_40px_rgba(0,0,0,0.45)]",
            placement === "up" ? "bottom-full left-0 mb-2" : "right-0 top-full mt-2",
          )}
        >
          <p className="truncate px-3 py-2 text-sm text-grey">{profile.email}</p>
          <Link
            role="menuitem"
            href="/account/password"
            className="block rounded-xl px-3 py-2 text-sm font-semibold text-white hover:bg-white/10"
            onClick={() => setOpen(false)}
          >
            Change password
          </Link>
          <form action={signOut}>
            <button
              type="submit"
              role="menuitem"
              className="block w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-white hover:bg-white/10"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

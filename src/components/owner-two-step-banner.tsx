"use client";

import Link from "next/link";
import { useState } from "react";

export function OwnerTwoStepBanner({ show }: { show: boolean }) {
  const [open, setOpen] = useState(show);
  if (!open) return null;
  return (
    <div className="border-b border-line bg-card px-4 py-3 text-ink">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3">
        <p className="text-sm font-semibold">
          Two-step sign-in is due.{" "}
          <Link href="/settings/account/security" className="underline decoration-red underline-offset-4">
            Set it up
          </Link>
        </p>
        <button
          type="button"
          className="min-h-11 shrink-0 px-3 text-sm font-semibold"
          onClick={() => {
            document.cookie = "pulse-two-step-banner=1; Path=/; SameSite=Lax";
            setOpen(false);
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

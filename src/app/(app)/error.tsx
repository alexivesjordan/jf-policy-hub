"use client";

import { useEffect } from "react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="font-display text-3xl">Something went wrong</h1>
      <p className="leading-7 text-ink/80">Refresh the page. If it keeps happening, tell an administrator.</p>
      <button type="button" onClick={() => reset()} className="rounded-full bg-clay px-4 py-2 font-semibold text-white">
        Try again
      </button>
    </div>
  );
}

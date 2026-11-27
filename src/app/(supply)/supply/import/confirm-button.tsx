"use client";

import { useState } from "react";

export function ConfirmButton({
  label,
  confirm,
  action,
  id,
}: {
  label: string;
  confirm: string;
  action: (formData: FormData) => void;
  id: string;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return <button type="button" className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold" onClick={() => setOpen(true)}>{label}</button>;
  }
  return (
    <form action={action} className="rounded-2xl border border-line bg-paper p-3">
      <p className="text-sm font-semibold">{confirm}</p>
      <input type="hidden" name="id" value={id} />
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="inline-flex min-h-11 items-center rounded-full bg-red px-4 text-sm font-semibold text-white" type="submit">{label}</button>
        <button className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold" type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

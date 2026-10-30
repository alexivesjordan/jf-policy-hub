"use client";

import { useRef, useState } from "react";
import { PolicyContent } from "@/components/policy-content";

export function MarkdownEditor({ name, defaultValue }: { name: string; defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const ref = useRef<HTMLTextAreaElement>(null);

  function apply(prefix: string, suffix = "") {
    const field = ref.current;
    if (!field) return;
    const start = field.selectionStart;
    const end = field.selectionEnd;
    const selected = value.slice(start, end) || "text";
    const next = `${value.slice(0, start)}${prefix}${selected}${suffix}${value.slice(end)}`;
    setValue(next);
    requestAnimationFrame(() => {
      field.focus();
      const cursor = start + prefix.length + selected.length;
      field.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-full border border-line bg-field px-3 py-1.5 text-sm font-semibold" onClick={() => apply("## ")}>
          Heading
        </button>
        <button type="button" className="rounded-full border border-line bg-field px-3 py-1.5 text-sm font-semibold" onClick={() => apply("**", "**")}>
          Bold
        </button>
        <button type="button" className="rounded-full border border-line bg-field px-3 py-1.5 text-sm font-semibold" onClick={() => apply("- ")}>
          List
        </button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <textarea
          ref={ref}
          name={name}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="min-h-80 w-full rounded-2xl border border-line bg-field px-3 py-3 text-base leading-7 outline-none ring-red focus:ring-2"
        />
        <div className="min-h-80 rounded-2xl border border-line bg-paper/50 px-4 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-grey">Preview</p>
          {value.trim() ? <PolicyContent markdown={value} /> : <p className="text-sm text-ink/60">The preview appears here as you write.</p>}
        </div>
      </div>
    </div>
  );
}

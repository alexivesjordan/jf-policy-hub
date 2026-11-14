"use client";

const selected = "border-red bg-red text-white";
const idle = "border-line bg-card text-ink";

export function YesNo({ label, value, onChange }: { label: string; value: boolean | null; onChange: (next: boolean) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-ink">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        {([true, false] as const).map((next) => (
          <button
            key={String(next)}
            type="button"
            aria-pressed={value === next}
            onClick={() => onChange(next)}
            className={`min-h-12 rounded-2xl border text-base font-semibold ${value === next ? selected : idle}`}
          >
            {next ? "Yes" : "No"}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function Choice({ label, selected: on, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`min-h-14 w-full rounded-2xl border text-base font-semibold ${on ? selected : idle}`}>
      {label}
    </button>
  );
}

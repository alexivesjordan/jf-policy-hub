export function AllowanceRing({ taken, booked, left }: { taken: number; booked: number; left: number }) {
  const total = Math.max(taken + booked + left, 0.5);
  const takenEnd = (taken / total) * 100;
  const bookedEnd = takenEnd + (booked / total) * 100;
  return (
    <div className="flex items-center gap-5">
      <div
        className="grid size-28 shrink-0 place-items-center rounded-full"
        style={{ background: `conic-gradient(var(--red) 0 ${takenEnd}%, var(--ink) ${takenEnd}% ${bookedEnd}%, var(--line) ${bookedEnd}% 100%)` }}
        aria-hidden="true"
      >
        <div className="grid size-20 place-items-center rounded-full bg-card text-center">
          <p className="font-display text-3xl leading-none">{left}</p>
          <p className="text-xs text-grey">left</p>
        </div>
      </div>
      <ul className="space-y-1 text-sm">
        <li>Taken {taken}</li>
        <li>Booked {booked}</li>
        <li>Left {left}</li>
      </ul>
    </div>
  );
}

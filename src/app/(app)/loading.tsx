export default function Loading() {
  return (
    <div className="space-y-4" aria-live="polite">
      <div className="h-8 w-48 rounded-full bg-line" />
      <div className="h-24 rounded-3xl bg-white" />
      <div className="h-24 rounded-3xl bg-white" />
      <p className="text-sm text-ink/60">Loading...</p>
    </div>
  );
}

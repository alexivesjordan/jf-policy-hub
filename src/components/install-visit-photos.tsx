const LABELS: Record<string, string> = {
  concern: "Concern",
  equipment: "Equipment",
};

export function InstallVisitPhotos({
  photos,
}: {
  photos: { id: string; kind: string; url: string | null }[];
}) {
  const counts = new Map<string, number>();
  const rows = photos.map((photo) => {
    const base = LABELS[photo.kind] ?? "Photo";
    const next = (counts.get(base) ?? 0) + 1;
    counts.set(base, next);
    return { ...photo, label: `${base} ${next}` };
  });
  return (
    <section className="rounded-3xl border border-line bg-card px-6 py-5">
      <h2 className="font-display text-2xl">Photos</h2>
      {rows.length === 0 ? <p className="mt-2 text-sm text-grey">No visit photos yet.</p> : (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {rows.map((photo) => (
            <li key={photo.id} className="overflow-hidden rounded-2xl border border-line bg-field">
              {photo.url ? (
                // Signed for a few minutes. The file stays on the install.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.url} alt={photo.label} className="aspect-square w-full object-cover" />
              ) : <div className="aspect-square w-full" />}
              <p className="px-3 py-2 text-sm font-semibold">{photo.label}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

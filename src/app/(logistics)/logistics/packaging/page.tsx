import { PackagingGrid, PackagingTools } from "@/components/logistics/packaging-grid";
import { listSkuPackages } from "@/features/logistics/packing/queries";

export const metadata = { title: "Packaging" };

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function PackagingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const search = one(params.search).slice(0, 80);
  const missing = one(params.missing) === "1";
  const page = Math.max(0, Number.parseInt(one(params.page), 10) || 0);
  let rows: Awaited<ReturnType<typeof listSkuPackages>>["rows"] = [];
  let total = 0;
  let error = "";
  try {
    const listed = await listSkuPackages({ search, missing, offset: page * 50 });
    rows = listed.rows;
    total = listed.total;
  } catch (err) {
    error = err instanceof Error ? err.message : "Could not load packaging.";
  }
  const query = new URLSearchParams();
  if (search) query.set("search", search);
  if (missing) query.set("missing", "1");
  return (
    <div className="space-y-4">
      <h1 className="font-display text-4xl">Packaging</h1>
      {error ? <p role="alert" className="font-semibold">{error}</p> : null}
      <PackagingTools exportHref={`/api/logistics/packaging/export?${query.toString()}`} />
      <PackagingGrid rows={rows} page={page} total={total} filters={{ search, missing }} />
    </div>
  );
}

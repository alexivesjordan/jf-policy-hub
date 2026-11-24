import { countryName } from "@/features/logistics/commercial-invoice/rules";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Search Commercial Invoices" };

type SearchRow = {
  id: string;
  number: string;
  revision: number;
  issuedAt: string;
  customer: string;
  destination: string;
  issuedBy: string;
  orders: string[];
};

function isoDay(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function rowsFrom(data: unknown): SearchRow[] {
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Partial<SearchRow>;
    if (typeof row.id !== "string" || typeof row.number !== "string") return [];
    return [{
      id: row.id,
      number: row.number,
      revision: typeof row.revision === "number" ? row.revision : 1,
      issuedAt: typeof row.issuedAt === "string" ? row.issuedAt : "",
      customer: typeof row.customer === "string" ? row.customer : "",
      destination: typeof row.destination === "string" ? row.destination : "",
      issuedBy: typeof row.issuedBy === "string" ? row.issuedBy : "",
      orders: Array.isArray(row.orders) ? row.orders.filter((order): order is string => typeof order === "string") : [],
    }];
  });
}

function issuedOn(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "medium" }).format(date);
}

export default async function SearchCommercialInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").slice(0, 80);
  const from = isoDay(params.from);
  const to = isoDay(params.to);
  const supabase = await createClient();
  const result = await supabase.rpc("logistics_search_commercial_invoices", {
    p_query: q,
    p_from: from || null,
    p_to: to || null,
  });
  const rows = rowsFrom(result.data);
  const message = result.error ? "Commercial invoices could not be searched." : "";

  return (
    <div className="space-y-4">
      <h1 className="font-display text-4xl">Search Commercial Invoices</h1>
      <form className="flex flex-wrap items-end gap-3" action="/logistics/commercial-invoices/search">
        <label className="text-sm font-semibold">
          Search
          <input name="q" defaultValue={q} className="mt-1 block rounded-xl border border-line bg-paper px-3 py-2" />
        </label>
        <label className="text-sm font-semibold">
          From
          <input type="date" name="from" defaultValue={from} className="mt-1 block rounded-xl border border-line bg-paper px-3 py-2" />
        </label>
        <label className="text-sm font-semibold">
          To
          <input type="date" name="to" defaultValue={to} className="mt-1 block rounded-xl border border-line bg-paper px-3 py-2" />
        </label>
        <button type="submit" className="rounded-xl bg-red px-4 py-2 font-semibold text-white">Search</button>
      </form>
      {message ? <p role="alert" className="font-semibold">{message}</p> : null}
      {rows.length === 0 && !message ? <p>No invoices.</p> : null}
      {rows.length ? (
        <div className="overflow-x-auto rounded-3xl border border-line bg-card">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide">
                <th className="px-3 py-3">CI number</th>
                <th className="px-3 py-3">Order</th>
                <th className="px-3 py-3">Customer</th>
                <th className="px-3 py-3">Destination</th>
                <th className="px-3 py-3">Date</th>
                <th className="px-3 py-3">Issued by</th>
                <th className="px-3 py-3">Revision</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-3 font-semibold">{row.number}</td>
                  <td className="px-3 py-3">{row.orders.join(", ")}</td>
                  <td className="px-3 py-3">{row.customer}</td>
                  <td className="px-3 py-3">{row.destination ? countryName(row.destination) : ""}</td>
                  <td className="px-3 py-3">{issuedOn(row.issuedAt)}</td>
                  <td className="px-3 py-3">{row.issuedBy}</td>
                  <td className="px-3 py-3">{row.revision > 1 ? `R${row.revision}` : "1"}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      <a className="font-semibold underline" href={`/api/logistics/commercial-invoices/${row.id}`} target="_blank" rel="noreferrer">View</a>
                      <a className="font-semibold underline" href={`/api/logistics/commercial-invoices/${row.id}`} download>Reprint</a>
                      <a className="font-semibold underline" href={`/logistics/commercial-invoices?from=${row.id}`}>Regenerate</a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

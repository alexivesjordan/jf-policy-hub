export type SalesPulseRow = {
  id: string;
  kind: "quote" | "install";
  orderNumber: string;
  customerName: string;
  meta?: string | null;
};

const ID = /^[0-9a-f-]{36}$/i;

export function salesPulseHref(row: { kind?: string; id?: string; orderNumber?: string }) {
  if (row.kind === "quote") {
    const order = row.orderNumber?.trim() ?? "";
    return order ? `/sales/quote?order=${encodeURIComponent(order)}` : "/sales/quote";
  }
  if (row.kind === "install" && row.id && ID.test(row.id)) return `/sales/installs/${row.id}`;
  return "/sales/installs";
}

export function salesPulseMeta(row: { awaiting?: unknown; startOn?: unknown }) {
  const awaiting = Number(row.awaiting);
  if (Number.isFinite(awaiting) && awaiting > 0) return awaiting === 1 ? "1 sent" : `${awaiting} sent`;
  if (typeof row.startOn === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(row.startOn);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const name = match ? months[Number(match[2]) - 1] : undefined;
    if (name) return `${Number(match?.[3])} ${name}`;
  }
  return null;
}

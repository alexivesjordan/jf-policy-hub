import { projectInstall, type InstallRecord } from "@/lib/pulse/install-booking";

const WARRANTY: Record<string, string> = {
  annual: "Annual maintenance",
  twice_yearly: "Twice-yearly maintenance",
  extension: "5-year parts warranty",
  annual_bundle: "Year 1 bundle · annual maintenance",
  twice_yearly_bundle: "Year 1 bundle · twice-yearly maintenance",
};

const STATUS: Record<string, string> = {
  quoting: "Quoting",
  booked: "Booked",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function ukDate(value: unknown) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  if (!match) return "Not set";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function money(value: unknown) {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(amount);
}

export function salesInstall(record: InstallRecord) {
  return projectInstall(record, "sales");
}

export function InstallSalesView({
  install,
  proposalUrl,
}: {
  install: InstallRecord;
  proposalUrl?: string | null;
}) {
  const row = salesInstall(install);
  const warranty = row.warrantyOption ? WARRANTY[String(row.warrantyOption)] ?? String(row.warrantyOption) : "None";
  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-line bg-card px-6 py-6">
        <p className="text-sm text-grey">Order {String(row.orderNumber ?? "—")}</p>
        <h1 className="font-display mt-1 text-3xl">{String(row.customerName ?? "Install")}</h1>
        <p className="mt-2 text-sm text-grey">
          {String(row.stage) === "quoting" ? "Quoting" : `Booked for ${ukDate(row.startOn)} – ${ukDate(row.endOn)}`}
        </p>
        <dl className="mt-4 divide-y divide-border text-sm">
          <Row label="Order value" value={money(row.goodsNet)} />
          <Row label="Install price" value={String(row.stage) === "quoting" || row.installPrice == null ? "—" : money(row.installPrice)} />
          <Row label="Warranty and maintenance" value={warranty} />
          <Row label="Warranty and maintenance price" value={row.warrantyPrice == null ? "—" : money(row.warrantyPrice)} />
          <Row label="Status" value={STATUS[String(row.status)] ?? String(row.status ?? "—")} />
          <Row label="Booked by" value={String(row.bookingRepName ?? "—")} />
          <Row label="Contact" value={[row.contactName, row.contactEmail, row.contactPhone].filter(Boolean).join(" · ") || "—"} />
          <Row label="Site" value={String(row.siteAddress ?? "—")} />
        </dl>
        {proposalUrl ? (
          <p className="mt-4 text-sm">
            <a className="font-semibold underline decoration-primary" href={proposalUrl}>Download the proposal</a>
          </p>
        ) : null}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-grey">{label}</dt>
      <dd className="text-right font-semibold text-ink">{value}</dd>
    </div>
  );
}

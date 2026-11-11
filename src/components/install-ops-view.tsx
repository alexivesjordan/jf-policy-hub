import { InstallSalesView } from "@/components/install-sales-view";
import { InstallOpsControls } from "@/components/install-ops-controls";
import { projectInstall, type InstallRecord } from "@/lib/pulse/install-booking";

export function InstallOpsView({
  install,
  proposalUrl,
  canEdit,
}: {
  install: InstallRecord;
  proposalUrl?: string | null;
  canEdit: boolean;
}) {
  const row = projectInstall(install, "ops");
  const lines = Array.isArray(row.lines) ? row.lines : [];
  const resources = Array.isArray(row.resources) ? row.resources : [];
  const hq = row.hqBuild && typeof row.hqBuild === "object" ? row.hqBuild as { personHours?: number; lines?: { productName?: string; qty?: number; minutes?: number; crew?: number }[] } : null;
  const site = row.siteInstall && typeof row.siteInstall === "object" ? row.siteInstall as { days?: number; nights?: number; onSiteHours?: number } : null;
  const vans = row.vans && typeof row.vans === "object" ? row.vans as { size?: string; count?: number } : null;
  const flags = flagLines(row.flags);
  return (
    <div className="space-y-6">
      <InstallSalesView install={install} proposalUrl={proposalUrl} />
      <InstallOpsControls installId={String(row.id ?? "")} status={String(row.status ?? "booked")} canEdit={canEdit} />
      <section className="rounded-3xl border border-line bg-card px-6 py-5 text-sm">
        <h2 className="font-display text-2xl">Build</h2>
        <p className="mt-2">Crew {String(row.crew ?? "—")}. Vans {vans?.count ?? "—"} {vans?.size === "crafter" ? "Crafter" : "small"}.</p>
        <p className="mt-1">HQ build {hq?.personHours ?? 0} person-hours. Site {site?.days ?? "—"} day(s), {site?.onSiteHours ?? "—"} hours on site.</p>
        <p className="mt-1 text-grey">Cin7 sale {String(row.cin7SaleId ?? "—")} · customer {String(row.cin7CustomerId ?? "—")}</p>
        {resources.length > 0 ? (
          <ul className="mt-3 list-disc pl-5">
            {resources.map((resource, index) => <li key={index}>{resourceLabel(resource)}</li>)}
          </ul>
        ) : null}
      </section>
      {lines.length > 0 ? (
        <section className="rounded-3xl border border-line bg-card px-6 py-5 text-sm">
          <h2 className="font-display text-2xl">Products</h2>
          <ul className="mt-3 space-y-1">
            {lines.map((line, index) => <li key={index}>{lineLabel(line)}</li>)}
          </ul>
        </section>
      ) : null}
      {flags.length > 0 ? (
        <section className="rounded-3xl border border-line bg-card px-6 py-5 text-sm">
          <h2 className="font-display text-2xl">Flags</h2>
          <ul className="mt-3 list-disc space-y-1 pl-5">
            {flags.map((flag) => <li key={flag}>{flag}</li>)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function resourceLabel(resource: unknown) {
  if (resource && typeof resource === "object" && "name" in resource) return String((resource as { name?: unknown }).name ?? "Resource");
  return String(resource ?? "Resource");
}

function lineLabel(line: unknown) {
  if (!line || typeof line !== "object") return String(line ?? "");
  const row = line as { qty?: unknown; description?: unknown; sku?: unknown };
  return `${row.qty ?? "—"}× ${row.description ?? row.sku ?? "Product"}`;
}

function flagLines(flags: unknown) {
  if (Array.isArray(flags)) return flags.map((flag) => typeof flag === "string" ? flag : JSON.stringify(flag));
  if (flags && typeof flags === "object") {
    const bag = flags as { install?: unknown; service?: unknown };
    return [...asText(bag.install), ...asText(bag.service)];
  }
  return [];
}

function asText(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item : typeof item === "object" && item && "message" in item ? String((item as { message?: unknown }).message) : JSON.stringify(item)));
}

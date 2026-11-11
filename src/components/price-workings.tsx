import Link from "next/link";
import { QuoteNotice } from "@/components/quote-notice";
import type { QuoteBreakdown } from "@/lib/pricer/breakdown";

const SETTING_LABELS: Record<string, string> = {
  handover_minutes: "handover time",
  cover_cost_per_unit: "cover cost per unit",
  leave_behind_pack_cost: "leave-behind pack cost",
  food_trigger: "when food is charged",
  hq_handling_minutes: "HQ handling time",
  deck_cost_per_unit: "deck cost per unit",
  crate_capacity_kg: "crate capacity",
  lorry_tail_lift_kg: "lorry tail-lift weight limit",
  min_job_charge: "minimum job charge",
  margin_floor_pct: "margin floor",
  site_prep_minutes: "site preparation time",
  weight_band_midpoint: "weight-band midpoint",
  tag_cost_per_unit: "tag cost per unit",
  contingency_base: "base contingency",
  contingency_high_complexity: "high-complexity contingency",
  contingency_difficult_access: "difficult-access contingency",
  hq_unpack_crate_minutes_per_100kg: "time to unpack a crate",
};

function settingKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function plainSetting(value: string) {
  const key = settingKey(value);
  return SETTING_LABELS[key] ?? value.trim().replace(/_/g, " ");
}

function isSettingKey(value: string) {
  const key = settingKey(value);
  return Boolean(SETTING_LABELS[key]) || /^[a-z0-9_]+$/.test(value.trim());
}

function missingSettings(unset: string[]) {
  const labels = [...new Set(unset.filter(isSettingKey).map(plainSetting))];
  if (!labels.length) return "Nothing else is missing.";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function assumptionText(assumptions: string[]) {
  if (!assumptions.length) return "No extra assumptions.";
  const labels = assumptions.filter(isSettingKey).map(plainSetting);
  const notes = assumptions.filter((item) => !isSettingKey(item)).map(plainSentence);
  const lead = labels.length ? labels.join(", ") : "";
  return [lead, ...notes].filter(Boolean).join(". ");
}

function plainSentence(value: string) {
  return value
    .replace(/[a-z0-9]+(?:_[a-z0-9]+)+/gi, (token) => plainSetting(token))
    .replace(/\bUNSET\b/g, "not set")
    .replace(/\s+/g, " ")
    .trim();
}

function plainPayment(gate: string) {
  if (gate.includes("Customer type not set")) {
    return gate.replace("Customer type not set.", "Customer type is not set, so the payment terms are not chosen yet.");
  }
  return gate;
}

function segmentSentence(segment: string | null, markup: number | null) {
  const who = segment === "independent"
    ? "an independent customer"
    : segment === "franchisee"
      ? "a franchisee"
      : segment === "trade"
        ? "a trade customer"
        : segment === "big_corporate"
          ? "a big corporate customer"
          : "a customer whose segment is not set";
  if (markup == null) return `This is ${who}. No markup is set.`;
  const percent = Math.round(markup * 1000) / 10;
  return `This is ${who}. The markup on cost is ${percent}%.`;
}

function money(value: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

export function PriceWorkings({
  breakdown,
  notice,
  customerPrice,
  segment,
  markup,
  flags = [],
}: {
  breakdown: QuoteBreakdown;
  notice: string | null;
  customerPrice: number;
  segment: string | null;
  markup: number | null;
  flags?: string[];
}) {
  const cheaper = [breakdown.commute, breakdown.stayOvernight].slice().sort((a, b) => a.cost - b.cost)[0];

  return (
    <div className="space-y-4 text-sm text-ink">
      {notice ? <QuoteNotice>{notice}</QuoteNotice> : null}
      {flags.filter((flag) => flag.startsWith("Needs review:")).map((flag) => (
        <p key={flag} className="rounded-2xl border border-line bg-card px-4 py-3 text-sm text-grey">
          {flag}{" "}
          <Link href="/operations/settings?status=suggested" className="font-semibold text-ink underline decoration-red">Open the effort table</Link>
        </p>
      ))}
      <section className="rounded-3xl border border-line bg-card px-5 py-4">
        <h2 className="font-display text-2xl">Line classification</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="text-grey">
                <th className="py-1 pr-3">Product</th>
                <th className="py-1 pr-3">Qty</th>
                <th className="py-1 pr-3">Category</th>
                <th className="py-1 pr-3">Match</th>
                <th className="py-1 pr-3">Crew</th>
                <th className="py-1">Minutes</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.classified.map((line) => (
                <tr key={`${line.productName}-${line.qty}-${line.category}`} className="border-t border-line">
                  <td className="py-1 pr-3">{line.productName}</td>
                  <td className="py-1 pr-3">{line.qty}</td>
                  <td className="py-1 pr-3">{line.category ?? "—"}</td>
                  <td className="py-1 pr-3">{line.match}</td>
                  <td className="py-1 pr-3">{line.buildCrew ?? "—"}</td>
                  <td className="py-1">{line.buildMinutes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="rounded-3xl border border-line bg-card px-5 py-4">
        <h2 className="font-display text-2xl">HQ build and dispatch</h2>
        {breakdown.hq ? (
          <div className="mt-2 space-y-1">
            {breakdown.hq.lines.map((line) => (
              <p key={line.productName}>{line.qty}× {line.productName} → {line.minutes} min × {line.crew} crew</p>
            ))}
            <p>HQ person-hours {breakdown.hq.personHours} → labour {money(breakdown.hq.labour)}</p>
            <p>Handling is not set. Deck cost is not set. Crates are to be confirmed ({breakdown.hq.crateHours} h).</p>
            <p>A tail-lift lorry is the default. The tail-lift weight limit is not set, so that check is flagged and not priced.</p>
            <p>HQ subtotal {money(breakdown.hq.subtotal)}</p>
          </div>
        ) : (
          <p className="mt-2 text-grey">No HQ-built lines.</p>
        )}
      </section>
      <section className="rounded-3xl border border-line bg-card px-5 py-4">
        <h2 className="font-display text-2xl">Site install</h2>
        <p className="mt-2">Site prep {breakdown.prepMinutes} min. Handover time is not set yet.</p>
        <p>On site {breakdown.onSiteHours} h. Carry {breakdown.carryHours} h. Travel {breakdown.travelHours} h ({breakdown.roundTripMiles} miles, {breakdown.milesMethod}).</p>
        <ul className="mt-2 space-y-1">
          {breakdown.buildLines.map((line) => (
            <li key={`build-${line.productName}`}>{line.qty}× {line.productName} → {line.minutes} min</li>
          ))}
        </ul>
        <p className="mt-3">Crew {breakdown.crew}. Vans {breakdown.vans}. Licensed drivers {breakdown.licensedDrivers}. {breakdown.days} day{breakdown.days === 1 ? "" : "s"} / {breakdown.nights} night{breakdown.nights === 1 ? "" : "s"} at {breakdown.speedMph} mph.</p>
        <p>Hotel {money(breakdown.hotel)}. Food {money(breakdown.food)}.</p>
        <p>{breakdown.driverCheck}</p>
        <p className="mt-3 font-semibold">Crew plans</p>
        {breakdown.crewPlans.map((plan) => (
          <p key={plan.id}>
            {plan.label}: {plan.days} day{plan.days === 1 ? "" : "s"} / {plan.nights} night{plan.nights === 1 ? "" : "s"}
            {" · "}labour {money(plan.labour)} · site {money(plan.siteCost)}
            {plan.note.includes("Recommended") ? " — recommended" : ""}
          </p>
        ))}
        <p className="mt-3 font-semibold">Overnight versus commute</p>
        {[breakdown.singleShift, breakdown.commute, breakdown.stayOvernight].map((option) => (
          <p key={option.label}>
            {option.label}: {option.days} day{option.days === 1 ? "" : "s"}
            {option.nights ? `, ${option.nights} night${option.nights === 1 ? "" : "s"}` : ""}
            {" · "}door-to-door {option.doorToDoorHours} h · {money(option.cost)}
            {option.label === "Single shift" ? " — used for this price" : ""}
            {option.label === cheaper?.label ? " — cheaper of the two stays" : ""}
          </p>
        ))}
        <p className="mt-3">Labour {money(breakdown.labour)}. Vehicle {money(breakdown.vehicle)}. Freight {money(breakdown.freight)}. Consumables {money(breakdown.consumables)}.</p>
        <p>Contingency {Math.round(breakdown.contingencyRate * 100)}% = {money(breakdown.siteContingency)}. Site subtotal {money(breakdown.siteCost)}.</p>
      </section>
      <section className="rounded-3xl border border-line bg-card px-5 py-4">
        <p>{segmentSentence(segment, markup)}</p>
        <p className="font-display mt-2 text-3xl">{money(customerPrice)} ex VAT</p>
        <p className="text-grey">Internal cost {money(breakdown.siteCost + breakdown.hqCost)}</p>
        <details open className="group mt-4 rounded-2xl border border-border">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
            Assumptions and missing settings
          </summary>
          <dl className="space-y-3 px-4 pb-4 text-sm">
            <div>
              <dt className="font-semibold">{breakdown.bigInstall ? "This is a big install" : "This is not a big install"}</dt>
              <dd className="mt-1 text-grey">
                {breakdown.bigInstall
                  ? `Photos or a walkthrough are required before booking${breakdown.bigInstallTriggers.length ? `: ${breakdown.bigInstallTriggers.map(plainSetting).join(", ")}` : ""}.`
                  : "Photos and a walkthrough are not required before booking."}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Payment terms</dt>
              <dd className="mt-1 text-grey">{plainPayment(breakdown.paymentGate)}</dd>
            </div>
            <div>
              <dt className="font-semibold">Not yet set in the effort table</dt>
              <dd className="mt-1 text-grey">{missingSettings(breakdown.unset)}</dd>
            </div>
            <div>
              <dt className="font-semibold">Assumptions used for this price</dt>
              <dd className="mt-1 text-grey">{assumptionText(breakdown.assumptions)}</dd>
            </div>
          </dl>
        </details>
      </section>
    </div>
  );
}

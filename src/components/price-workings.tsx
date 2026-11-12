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

function isBuildRecipe(value: string) {
  return /crew\s*\d|build minutes|hq build|site position|person-hours|\blabour\b|assembly team/i.test(value) || value.length > 240;
}

function assumptionText(assumptions: string[]) {
  const shared = assumptions.filter((item) => !isBuildRecipe(item));
  if (!shared.length) return "No extra assumptions.";
  const labels = shared.filter(isSettingKey).map(plainSetting);
  const notes = shared.filter((item) => !isSettingKey(item)).map(plainSentence);
  const lead = labels.length ? labels.join(", ") : "";
  return [lead, ...notes].filter(Boolean).join(". ");
}

function plainSentence(value: string) {
  return value
    .replace(/[a-z0-9]+(?:_[a-z0-9]+)+/gi, (token) => plainSetting(token))
    .replace(/\bUNSET\b/g, "not set")
    .replace(/GENERIC PROVISIONAL/gi, "provisional")
    .replace(/SKU blank - add Cin7 SKU so quote lines match exactly\.?/gi, "no SKU, so it is matched by name.")
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

export type InstallPriceNotesData = {
  bigInstall: boolean;
  bigInstallTriggers: string[];
  paymentGate: string;
  unset: string[];
  assumptions: string[];
  flags?: string[];
};

/** A short list. Per-line weight and SKU notes are folded into one line each. */
export function compactPriceFlags(notes: InstallPriceNotesData) {
  const flags = (notes.flags ?? []).filter((flag) => !/^Crew plan:/i.test(flag) && !isBuildRecipe(flag));
  const items = [
    notes.bigInstall
      ? "This is a big install. Photos or a walkthrough are required before booking."
      : "This is not a big install. Photos and a walkthrough are not required before booking.",
    plainPayment(notes.paymentGate),
  ];
  const missing = notes.unset.filter(isSettingKey);
  if (missing.length === 1) items.push(`${plainSetting(missing[0])} is not set yet.`);
  else if (missing.length > 1) items.push("Some effort-table settings are not set yet.");
  const needsReview = flags.filter((flag) => flag.startsWith("Needs review:"));
  if (needsReview.length === 1) items.push(needsReview[0].replace(/ Confirm them on the Pricing page\./, ""));
  else if (needsReview.length > 1) items.push("Some products still need a confirmed install time.");
  if (flags.some((flag) => /weight unknown|weight estimated/i.test(flag))) items.push("Some product weights were estimated or missing.");
  if (flags.some((flag) => /SKU blank|no SKU/i.test(flag))) items.push("Some lines have no SKU, so they were matched by name.");
  return items.filter((item) => item && !/\b1\.30\b|risk formula/i.test(item)).slice(0, 6);
}

export function InstallPriceNotes({ notes }: { notes: InstallPriceNotesData }) {
  const items = compactPriceFlags(notes);
  return (
    <section className="rounded-3xl border border-line bg-card px-6 py-5">
      <h3 className="font-display text-xl">Things that may affect this price</h3>
      {items.length === 0 ? <p className="mt-2 text-sm text-grey">No flags on this quote.</p> : (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{items.map((item) => <li key={item}>{item}</li>)}</ul>
      )}
    </section>
  );
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
      </section>
      <InstallPriceNotes
        notes={{
          bigInstall: breakdown.bigInstall,
          bigInstallTriggers: breakdown.bigInstallTriggers,
          paymentGate: breakdown.paymentGate,
          unset: breakdown.unset,
          assumptions: breakdown.assumptions,
        }}
      />
      {breakdown.assumptions.some(isBuildRecipe) ? (
        <section className="rounded-3xl border border-line bg-card px-5 py-4">
          <h2 className="font-display text-2xl">Build notes</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-grey">
            {breakdown.assumptions.filter(isBuildRecipe).map((note) => <li key={note}>{plainSentence(note)}</li>)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

import type { QuoteBreakdown } from "@/lib/pricer/breakdown";

function money(value: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

export function PriceWorkings({
  breakdown,
  notice,
  customerPrice,
  segment,
  markup,
}: {
  breakdown: QuoteBreakdown;
  notice: string | null;
  customerPrice: number;
  segment: string | null;
  markup: number | null;
}) {
  const cheaper = [breakdown.commute, breakdown.stayOvernight].slice().sort((a, b) => a.cost - b.cost)[0];

  return (
    <div className="space-y-4 text-sm text-ink">
      {notice ? <blockquote className="rounded-3xl border border-red bg-card px-5 py-4 leading-6">{notice}</blockquote> : null}
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
            <p>Handling: {breakdown.hq.handling}. Decks: {breakdown.hq.materials}. Crates: {breakdown.hq.crates} ({breakdown.hq.crateHours} h).</p>
            <p>{breakdown.hq.transport}</p>
            <p>HQ subtotal {money(breakdown.hq.subtotal)}</p>
          </div>
        ) : (
          <p className="mt-2 text-grey">No HQ-built lines.</p>
        )}
      </section>
      <section className="rounded-3xl border border-line bg-card px-5 py-4">
        <h2 className="font-display text-2xl">Site install</h2>
        <p className="mt-2">Site prep {breakdown.prepMinutes} min. Handover {breakdown.handover}.</p>
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
        <p>BIG INSTALL {breakdown.bigInstall ? `Y (${breakdown.bigInstallTriggers.join(", ") || "flagged"})` : "N"}</p>
        <p className="mt-2">{breakdown.paymentGate}</p>
        <p className="mt-2">Assumptions: {breakdown.assumptions.length ? breakdown.assumptions.join("; ") : "none"}</p>
        <p>UNSET: {breakdown.unset.join(", ")}</p>
        <p className="mt-3">Segment {segment ?? "—"} at {markup == null ? "—" : `${Math.round(markup * 1000) / 10}%`}.</p>
        <p className="font-display mt-2 text-3xl">{money(customerPrice)} ex VAT</p>
        <p className="text-grey">Internal cost {money(breakdown.siteCost + breakdown.hqCost)}</p>
      </section>
    </div>
  );
}

"use client";

import { useState } from "react";
import { LandedCalculator } from "@/components/logistics/landed-cost-calculator";
import { LandedHistory } from "@/components/logistics/landed-cost-history";
import { LandedRates } from "@/components/logistics/landed-cost-rates";
import { LandedShipment } from "@/components/logistics/landed-cost-shipment";

const tabs = [
  { id: "calculator", label: "Calculator" },
  { id: "shipment", label: "Shipment" },
  { id: "rates", label: "Rates" },
  { id: "history", label: "History" },
] as const;

type Tab = (typeof tabs)[number]["id"];

export function LandedCostApp() {
  const [tab, setTab] = useState<Tab>("calculator");
  return (
    <div className="space-y-4">
      <div role="tablist" className="flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper" : "rounded-full border border-line px-4 py-2 text-sm font-semibold"}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "calculator" ? <LandedCalculator /> : null}
      {tab === "shipment" ? <LandedShipment /> : null}
      {tab === "rates" ? <LandedRates /> : null}
      {tab === "history" ? <LandedHistory /> : null}
    </div>
  );
}

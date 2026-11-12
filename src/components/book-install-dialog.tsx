"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { enGB } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/pulse/ui";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { bookInstall, listInstallStartDates } from "@/features/sales/install-actions";
import { isWeekend } from "@/lib/pulse/booking-range";
import type { WarrantyChoice } from "@/lib/pulse/install-booking";
import { ukDate } from "@/components/install-sales-view";

type WarrantyPrices = {
  annualPm: number;
  twiceYearlyPm: number;
  extendedWarrantyOneOff: number;
  annualBundleYear1: number | null;
  twiceBundleYear1: number | null;
};

function iso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function pounds(value: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

function useWideScreen() {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia("(min-width: 768px)");
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia("(min-width: 768px)").matches,
    () => false,
  );
}

export function BookInstallDialog({
  quoteId,
  warranty,
}: {
  quoteId: string;
  warranty: WarrantyPrices | null;
}) {
  const wide = useWideScreen();
  const [open, setOpen] = useState(false);
  const [dates, setDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [start, setStart] = useState<Date | undefined>();
  const [option, setOption] = useState<WarrantyChoice>("none");
  const [message, setMessage] = useState("");
  const [booked, setBooked] = useState<{ id: string; startOn: string; endOn: string } | null>(null);

  async function load() {
    const from = new Date().toISOString().slice(0, 10);
    const to = addDays(from, 42);
    setLoading(true);
    const result = await listInstallStartDates(quoteId, from, to);
    setDates(result.dates ?? []);
    setMessage(result.ok ? "" : result.message);
    setLoading(false);
  }

  const choices = warrantyChoices(warranty);

  async function confirm() {
    if (!start || isWeekend(iso(start))) return;
    setLoading(true);
    const result = await bookInstall(quoteId, iso(start), option);
    setLoading(false);
    if (!result.ok) {
      setMessage(result.message);
      if (result.dates && result.dates.length > 0) setDates(result.dates);
      setStart(undefined);
      return;
    }
    const row = result.install ?? {};
    setBooked({
      id: String(row.id ?? ""),
      startOn: String(row.startOn ?? iso(start)),
      endOn: String(row.endOn ?? iso(start)),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) void load(); }}>
      <DialogTrigger render={<Button type="button" />}>Book install</DialogTrigger>
      <DialogContent className="max-h-[min(92vh,52rem)] overflow-y-auto sm:max-w-md md:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Book install</DialogTitle>
        </DialogHeader>
        {booked ? (
          <div className="space-y-3 text-center">
            <p className="font-semibold">Booked for {ukDate(booked.startOn)} – {ukDate(booked.endOn)}</p>
            {booked.id ? <Link className="font-semibold underline decoration-primary" href={`/sales/installs/${booked.id}`}>Open the install</Link> : null}
          </div>
        ) : (
          <div className="space-y-6">
            {loading ? <p className="text-center text-sm text-grey">Checking free dates…</p> : null}
            {message ? <p className="text-center text-sm">{message}</p> : null}
            {!loading && dates.length === 0 ? <p className="text-center text-sm text-grey">No start dates are free in the next six weeks.</p> : null}
            <div className="flex justify-center">
              <Calendar
                mode="single"
                locale={enGB}
                weekStartsOn={1}
                numberOfMonths={wide ? 2 : 1}
                selected={start}
                onSelect={(day) => {
                  if (!day || isWeekend(iso(day))) return;
                  setStart(day);
                }}
                defaultMonth={dates[0] ? new Date(`${dates[0]}T12:00:00`) : undefined}
                disabled={(date) => isWeekend(iso(date)) || !dates.includes(iso(date))}
                className="mx-auto [--cell-size:2.75rem]"
              />
            </div>
            {choices.length > 1 ? (
              <fieldset className="mx-auto w-full max-w-xl space-y-1">
                <legend className="text-sm font-semibold">Maintenance and warranty</legend>
                {choices.map((choice) => (
                  <label key={choice.value} className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-2 text-sm hover:bg-muted">
                    <span className="flex items-center gap-2">
                      <input type="radio" name="warrantyOption" checked={option === choice.value} onChange={() => setOption(choice.value)} />
                      {choice.label}
                    </span>
                    <span className="tabular-nums">{choice.price == null ? "" : pounds(choice.price)}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}
          </div>
        )}
        {booked ? null : (
          <DialogFooter>
            <Button type="button" disabled={!start || loading} onClick={() => void confirm()}>Confirm booking</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function warrantyChoices(prices: WarrantyPrices | null): { value: WarrantyChoice; label: string; price: number | null }[] {
  const choices: { value: WarrantyChoice; label: string; price: number | null }[] = [
    { value: "none", label: "No maintenance or warranty", price: null },
  ];
  if (!prices) return choices;
  const add = (value: WarrantyChoice, label: string, amount: number | null) => {
    if (amount != null && amount > 0) choices.push({ value, label, price: amount });
  };
  add("annual", "Annual maintenance", prices.annualPm);
  add("twice_yearly", "Twice-yearly maintenance", prices.twiceYearlyPm);
  add("extension", "5-year parts warranty", prices.extendedWarrantyOneOff);
  add("annual_bundle", "Year 1 bundle · annual maintenance", prices.annualBundleYear1);
  add("twice_yearly_bundle", "Year 1 bundle · twice-yearly maintenance", prices.twiceBundleYear1);
  return choices;
}

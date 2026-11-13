"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { enGB } from "date-fns/locale";
import { money, ukDate } from "@/components/install-sales-view";
import { KANBAN_COLUMNS, firstFilledKanban, installCoversDay, kanbanAccessChip, kanbanColumn } from "@/lib/installs/access-ui";
import { isWeekend } from "@/lib/pulse/booking-range";

export type CalendarInstall = {
  id: string;
  orderNumber: string;
  customerName: string;
  startOn: string;
  endOn: string;
  stage: string;
  installPrice: unknown;
  mediaCount: number | null;
};

export function InstallMonthGrid({
  days,
  installs,
  basePath,
}: {
  days: string[];
  installs: CalendarInstall[];
  basePath: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const chosen = installs.filter((row) => selected && installCoversDay(row.startOn, row.endOn, selected));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-7 gap-1 md:hidden">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((label) => (
          <p key={label} className="text-center text-[10px] font-semibold text-grey">{label}</p>
        ))}
        {days.map((day) => {
          const count = installs.filter((row) => installCoversDay(row.startOn, row.endOn, day)).length;
          const active = selected === day;
          return (
            <button
              key={day}
              type="button"
              onClick={() => setSelected(day)}
              className={`flex min-h-12 flex-col items-center justify-center rounded-xl border px-0.5 ${active ? "border-primary bg-card" : "border-line bg-card"} ${isWeekend(day) ? "text-grey" : ""}`}
            >
              <span className="text-xs font-semibold">{day.slice(8)}</span>
              {count > 0 ? <span className="mt-1 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">{count}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="md:hidden">
        {selected ? (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{ukDate(selected)}</h2>
            {chosen.length === 0 ? <p className="text-sm text-grey">No installs</p> : <InstallList installs={chosen} basePath={basePath} />}
          </section>
        ) : (
          <p className="text-sm text-grey">Tap a day to see its installs.</p>
        )}
      </div>
      <div className="hidden gap-2 md:grid md:grid-cols-7">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((label) => (
          <p key={label} className="px-1 text-xs font-semibold text-grey">{label}</p>
        ))}
        {days.map((day) => {
          const rows = installs.filter((row) => installCoversDay(row.startOn, row.endOn, day));
          return (
            <div key={day} className="min-h-24 rounded-2xl border border-line bg-card p-2">
              <p className={`text-xs font-semibold ${isWeekend(day) ? "text-grey" : ""}`}>{format(new Date(`${day}T12:00:00`), "dd/MM", { locale: enGB })}</p>
              <ul className="mt-1 space-y-1">
                {rows.map((row) => (
                  <li key={row.id}>
                    <Link className="block rounded-lg bg-muted px-2 py-1 text-xs font-semibold" href={`${basePath}/${row.id}`}>
                      {row.orderNumber}
                      <span className="mt-0.5 block font-normal text-grey">{row.customerName}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function InstallKanban({ installs, basePath }: { installs: CalendarInstall[]; basePath: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const first = firstFilledKanban(installs.map((row) => row.stage));
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node || !first || window.matchMedia("(min-width: 768px)").matches) return;
    const column = node.querySelector<HTMLElement>(`[data-column="${first}"]`);
    if (column) node.scrollLeft = column.offsetLeft;
  }, [first]);
  return (
    <div ref={scroller} className="flex gap-3 overflow-x-auto pb-2 snap-x md:grid md:grid-cols-5 md:overflow-visible">
      {KANBAN_COLUMNS.map(([id, label]) => {
        const cards = installs.filter((row) => kanbanColumn(row.stage) === id);
        return (
          <section key={id} data-column={id} className="w-64 shrink-0 snap-start rounded-3xl bg-muted/50 p-3 md:w-auto">
            <h2 className="text-sm font-semibold">{label}</h2>
            <ul className="mt-3 space-y-2">
              {cards.map((card) => {
                const chip = kanbanAccessChip(card.stage, card.mediaCount);
                return (
                <li key={card.id}>
                  <Link href={`${basePath}/${card.id}`} className="block rounded-2xl border border-line bg-card p-3">
                    <p className="font-semibold">{card.customerName}</p>
                    <p className="text-sm text-grey">{card.orderNumber}</p>
                    {chip ? <span className="mt-2 inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold">{chip}</span> : null}
                    <p className="mt-2 text-sm">{ukDate(card.startOn)}</p>
                    <p className="text-sm font-semibold">{card.stage === "quoting" || card.installPrice == null ? "—" : money(card.installPrice)}</p>
                  </Link>
                </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function InstallList({ installs, basePath }: { installs: CalendarInstall[]; basePath: string }) {
  return (
    <ul className="space-y-2">
      {installs.map((row) => (
        <li key={row.id}>
          <Link href={`${basePath}/${row.id}`} className="block rounded-2xl border border-line bg-card p-3">
            <p className="font-semibold">{row.customerName}</p>
            <p className="text-sm text-grey">{row.orderNumber}</p>
            <p className="mt-1 text-sm">{ukDate(row.startOn)}</p>
            <p className="text-sm font-semibold">{money(row.installPrice)}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

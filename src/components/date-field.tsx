"use client";

import { useState } from "react";
import { format } from "date-fns";
import { enGB } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function parseIso(value: string | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function toIso(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** UK date field. The form still submits YYYY-MM-DD. The screen shows dd/mm/yyyy. */
export function DateField({
  name,
  defaultValue,
  required,
  disabled,
  id,
}: {
  name: string;
  defaultValue?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<Date | undefined>(() => parseIso(defaultValue));
  const label = date ? format(date, "dd/MM/yyyy", { locale: enGB }) : "dd/mm/yyyy";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <input type="hidden" name={name} value={date ? toIso(date) : ""} required={required} disabled={disabled} />
      <PopoverTrigger
        id={id}
        disabled={disabled}
        render={
          <button
            type="button"
            className={cn(
              "flex h-11 w-full items-center justify-between rounded-2xl border border-line bg-field px-3 text-left text-base text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60",
              !date && "text-muted-foreground",
            )}
          />
        }
      >
        <span>{label}</span>
        <CalendarIcon className="size-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent className="z-[80] w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={enGB}
          weekStartsOn={1}
          selected={date}
          defaultMonth={date}
          onSelect={(next) => {
            setDate(next);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

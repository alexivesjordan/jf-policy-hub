"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { setJobStatus } from "@/features/operations/actions";
import type { JobSummary } from "@/features/operations/types";
import { formatDate } from "@/lib/format";

const STORAGE_KEY = "pulse-jobs-view";
const VIEWS = [
  ["list", "List"],
  ["kanban", "Kanban"],
  ["calendar", "Calendar"],
] as const;

export const JOB_PIPELINE = [
  ["priced", "Priced"],
  ["sub_price_pending", "Sub price pending"],
  ["ordered", "Ordered"],
  ["awaiting_access", "Awaiting access"],
  ["variation", "Variation"],
  ["ready_to_book", "Ready to book"],
  ["booked", "Booked"],
  ["in_build", "In build"],
  ["ready_to_dispatch", "Ready to dispatch"],
  ["on_site", "On site"],
  ["completed", "Completed"],
  ["closed", "Closed"],
  ["on_hold", "On hold"],
  ["lost_cancelled", "Lost / cancelled"],
] as const;

type JobsView = (typeof VIEWS)[number][0];

function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function JobsBoard({
  jobs,
  view,
  explicit,
  canEdit,
  error,
}: {
  jobs: JobSummary[];
  view: JobsView;
  explicit: boolean;
  canEdit: boolean;
  error: string | null;
}) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<Record<string, { status: string; status_label: string }>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const rows = jobs.map((job) => (overrides[job.id] ? { ...job, ...overrides[job.id] } : job));

  useEffect(() => {
    if (explicit) {
      localStorage.setItem(STORAGE_KEY, view);
      return;
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "kanban" || stored === "calendar") {
      router.replace(`/operations/jobs?view=${stored}`);
    }
  }, [explicit, router, view]);

  function choose(next: JobsView) {
    localStorage.setItem(STORAGE_KEY, next);
    router.replace(next === "list" ? "/operations/jobs?view=list" : `/operations/jobs?view=${next}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl">Jobs</h1>
          <p className="mt-2 max-w-2xl text-ink/70">
            The list is the default. Owners can drag a card to change its status. Sales see their own jobs.
          </p>
        </div>
        <ToggleGroup
          aria-label="Jobs view"
          value={[view]}
          onValueChange={(next) => {
            const chosen = next[next.length - 1];
            if (chosen === "list" || chosen === "kanban" || chosen === "calendar") choose(chosen);
          }}
          className="rounded-full border border-line bg-card p-1"
        >
          {VIEWS.map(([value, label]) => (
            <ToggleGroupItem key={value} value={value} className="min-h-11 rounded-full px-4 text-sm font-semibold">
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      {error ? <p className="rounded-3xl border border-red bg-card px-5 py-4">{error}</p> : null}
      {notice ? <p className="text-sm text-ink">{notice}</p> : null}
      {rows.length === 0 && !error ? (
        <p className="rounded-3xl border border-dashed border-line bg-card px-5 py-8 text-ink/70">
          No jobs for this role. Fixture jobs are visible to the install lead, HQ, and the owner. A sales role only sees jobs they own.
        </p>
      ) : null}
      {view === "list" ? <JobList jobs={rows} /> : null}
      {view === "kanban" ? (
        <JobKanban
          jobs={rows}
          canEdit={canEdit}
          onMove={async (jobId, status) => {
            const label = JOB_PIPELINE.find(([code]) => code === status)?.[1] ?? status;
            setOverrides((current) => ({ ...current, [jobId]: { status, status_label: label } }));
            const result = await setJobStatus(jobId, status);
            if (!result?.ok) {
              setOverrides((current) => {
                const next = { ...current };
                delete next[jobId];
                return next;
              });
              setNotice(result?.message ?? "Could not move that job.");
            } else {
              setNotice(null);
            }
          }}
        />
      ) : null}
      {view === "calendar" ? <JobsMonth jobs={rows} /> : null}
    </div>
  );
}

function JobList({ jobs }: { jobs: JobSummary[] }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-line bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Order</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Dates</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <TableRow key={job.id}>
              <TableCell>
                <Link href={`/operations/jobs/${job.id}`} className="font-semibold text-ink underline decoration-red">
                  {job.customer_name}
                </Link>
                {job.fixture ? <Badge tone="pending">Fixture</Badge> : null}
              </TableCell>
              <TableCell>{job.cin7_order_number || job.cin7_number || "No order number"}</TableCell>
              <TableCell><Badge tone="active">{job.status_label}</Badge></TableCell>
              <TableCell className="text-grey">{jobDate(job)}{job.city ? ` · ${job.city}` : ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function JobKanban({
  jobs,
  canEdit,
  onMove,
}: {
  jobs: JobSummary[];
  canEdit: boolean;
  onMove: (jobId: string, status: string) => Promise<void>;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {JOB_PIPELINE.map(([status, label]) => {
        const column = jobs.filter((job) => job.status === status);
        return (
          <section
            key={status}
            className="w-72 shrink-0 rounded-3xl border border-line bg-mist p-3"
            onDragOver={(event) => {
              if (!canEdit) return;
              event.preventDefault();
            }}
            onDrop={(event) => {
              if (!canEdit) return;
              event.preventDefault();
              const jobId = event.dataTransfer.getData("text/plain");
              if (jobId) void onMove(jobId, status);
            }}
          >
            <h2 className="px-1 text-sm font-semibold text-ink">{label}</h2>
            <p className="px-1 text-xs text-grey">{column.length}</p>
            <ul className="mt-3 space-y-2">
              {column.map((job) => (
                <li
                  key={job.id}
                  draggable={canEdit}
                  onDragStart={(event) => event.dataTransfer.setData("text/plain", job.id)}
                  className={canEdit ? "cursor-grab" : undefined}
                >
                  <Link href={`/operations/jobs/${job.id}`} className="block rounded-2xl border border-line bg-card px-3 py-3">
                    <p className="font-semibold text-ink">{job.customer_name}</p>
                    <p className="mt-1 text-xs text-grey">{job.cin7_order_number || job.cin7_number || "No order number"}</p>
                    <p className="mt-1 text-xs text-grey">{jobDate(job)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function JobsMonth({ jobs }: { jobs: JobSummary[] }) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  });
  const title = cursor.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const weeks = useMemo(() => monthWeeks(cursor.getUTCFullYear(), cursor.getUTCMonth()), [cursor]);
  const placed = jobs.filter((job) => jobSpan(job));

  return (
    <div className="rounded-3xl border border-line bg-card px-4 py-5">
      <div className="grid grid-cols-[2.5rem_1fr_2.5rem] items-center">
        <button type="button" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-mist" aria-label="Previous month" onClick={() => setCursor(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - 1, 1)))}>
          <ChevronLeft aria-hidden="true" className="size-5" />
        </button>
        <h2 className="text-center font-display text-2xl">{title}</h2>
        <button type="button" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-mist" aria-label="Next month" onClick={() => setCursor(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1)))}>
          <ChevronRight aria-hidden="true" className="size-5" />
        </button>
      </div>
      <div className="mt-4 grid grid-cols-7 text-center text-xs font-semibold text-grey">
        {["M", "T", "W", "T", "F", "S", "S"].map((label, index) => <div key={`${label}-${index}`} className="py-2">{label}</div>)}
      </div>
      <div className="space-y-3">
        {weeks.map((week) => (
          <div key={week[0]}>
            <div className="grid grid-cols-7 text-center text-sm">
              {week.map((iso) => (
                <div key={iso} className={`py-1 ${iso.slice(0, 7) === monthKey(cursor) ? "text-ink" : "text-grey"}`}>{Number(iso.slice(8))}</div>
              ))}
            </div>
            <div className="mt-1 space-y-1">
              {placed.map((job) => {
                const span = barOnWeek(job, week[0]);
                if (!span) return null;
                return (
                  <Link
                    key={job.id}
                    href={`/operations/jobs/${job.id}`}
                    className="block truncate rounded-full bg-red px-2 py-1 text-xs font-semibold text-white"
                    style={{ marginLeft: `${(span.col / 7) * 100}%`, width: `${(span.span / 7) * 100}%` }}
                  >
                    {job.customer_name}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {placed.length === 0 ? <p className="mt-4 text-sm text-grey">No pencilled dates in this list yet.</p> : null}
    </div>
  );
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthWeeks(year: number, month: number) {
  const first = new Date(Date.UTC(year, month, 1));
  const startPad = (first.getUTCDay() + 6) % 7;
  const start = addDays(first.toISOString().slice(0, 10), -startPad);
  const weeks: string[][] = [];
  let cursor = start;
  for (let week = 0; week < 6; week += 1) {
    const days = Array.from({ length: 7 }, (_, index) => addDays(cursor, index));
    weeks.push(days);
    cursor = addDays(cursor, 7);
    if (cursor.slice(0, 7) > `${year}-${String(month + 1).padStart(2, "0")}` && week >= 3) break;
  }
  return weeks;
}

function jobSpan(job: JobSummary) {
  const start = (job.requested_date || job.booked_date || "").slice(0, 10);
  if (!start) return null;
  const end = (job.requested_end || job.booked_date || start).slice(0, 10);
  return { start, end: end < start ? start : end };
}

function barOnWeek(job: JobSummary, weekStart: string) {
  const span = jobSpan(job);
  if (!span) return null;
  const weekEnd = addDays(weekStart, 6);
  const start = span.start > weekStart ? span.start : weekStart;
  const end = span.end < weekEnd ? span.end : weekEnd;
  if (start > end) return null;
  const col = Math.round((Date.parse(`${start}T12:00:00Z`) - Date.parse(`${weekStart}T12:00:00Z`)) / 86400000);
  const length = Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86400000) + 1;
  return { col, span: length };
}

function jobDate(job: JobSummary) {
  if (job.requested_date) {
    return job.requested_end && job.requested_end !== job.requested_date
      ? `${formatDate(job.requested_date)} – ${formatDate(job.requested_end)}`
      : formatDate(job.requested_date);
  }
  return job.booked_date ? `Booked ${formatDate(job.booked_date)}` : "No date";
}

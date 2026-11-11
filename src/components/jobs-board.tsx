"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/pulse/ui";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState, ErrorState } from "@/components/pulse/states";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { setJobStatus } from "@/features/operations/actions";
import type { JobSummary } from "@/features/operations/types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

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
      <PageHeader
        eyebrow="Pulse Operations"
        title="Jobs"
        actions={
          <ToggleGroup
            aria-label="Jobs view"
            value={[view]}
            onValueChange={(next) => {
              const chosen = next[next.length - 1];
              if (chosen === "list" || chosen === "kanban" || chosen === "calendar") choose(chosen);
            }}
            className="w-full flex-wrap rounded-full border border-line bg-card p-1 sm:w-auto"
          >
            {VIEWS.map(([value, label]) => (
              <ToggleGroupItem key={value} value={value} className="min-h-11 flex-1 rounded-full px-4 text-sm font-semibold sm:flex-none">
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      />
      {error ? <ErrorState title="Jobs did not load" description={error} /> : null}
      {notice ? <p className="text-sm text-foreground" role="status">{notice}</p> : null}
      {rows.length === 0 && !error ? (
        <EmptyState
          title="No jobs for this role"
          description="Installs you can see will show up here."
        />
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
              const message = result?.message ?? "Could not move that job.";
              setNotice(message);
              toast.error(message);
            } else {
              setNotice(null);
              toast.success(`Moved to ${label}.`);
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
    <>
      <ul className="space-y-3 md:hidden">
        {jobs.map((job) => (
          <li key={job.id}>
            <Link href={`/operations/jobs/${job.id}`} className="block rounded-3xl border border-border bg-card px-4 py-4">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-foreground">{job.customer_name}</span>
                {job.fixture ? <Badge tone="pending">Fixture</Badge> : null}
              </span>
              <span className="mt-1 block text-sm text-muted-foreground">{job.cin7_order_number || job.cin7_number || "No order number"}</span>
              <span className="mt-2 flex items-center justify-between gap-2 text-sm">
                <Badge tone="active">{displayStatus(job.status_label)}</Badge>
                <span className="text-muted-foreground">{jobDate(job)}{job.city ? ` · ${job.city}` : ""}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-hidden rounded-3xl border border-line bg-card md:block">
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
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/operations/jobs/${job.id}`} className="font-semibold text-ink underline decoration-red">
                      {job.customer_name}
                    </Link>
                    {job.fixture ? <Badge tone="pending">Fixture</Badge> : null}
                  </div>
                </TableCell>
                <TableCell>{job.cin7_order_number || job.cin7_number || "No order number"}</TableCell>
                <TableCell><Badge tone="active">{displayStatus(job.status_label)}</Badge></TableCell>
                <TableCell className="text-grey">{jobDate(job)}{job.city ? ` · ${job.city}` : ""}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
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
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const active = jobs.find((job) => job.id === activeId) ?? null;
  const dragReady = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!canEdit || !event.over) return;
    const jobId = String(event.active.id);
    const overId = String(event.over.id);
    const status = JOB_PIPELINE.some(([code]) => code === overId) ? overId : jobs.find((job) => job.id === overId)?.status;
    const current = jobs.find((job) => job.id === jobId)?.status;
    if (status && current && status !== current) void onMove(jobId, status);
  }

  if (!dragReady) {
    return (
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2" aria-label="Job pipeline">
        {JOB_PIPELINE.map(([status, label]) => (
          <KanbanColumn key={status} status={status} label={label} jobs={jobs.filter((job) => job.status === status)} canEdit={false} onMove={onMove} />
        ))}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(event: DragStartEvent) => setActiveId(String(event.active.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={onDragEnd}
      accessibility={{
        announcements: {
          onDragStart({ active: dragged }) {
            const job = jobs.find((item) => item.id === dragged.id);
            return `Picked up ${job?.customer_name ?? "job"}. Use the arrow keys to choose a column, then space to drop.`;
          },
          onDragOver({ over }) {
            if (!over) return "Not over a column.";
            const label = JOB_PIPELINE.find(([code]) => code === String(over.id))?.[1];
            return label ? `Over ${label}.` : "Over another job.";
          },
          onDragEnd({ over }) {
            const label = over ? JOB_PIPELINE.find(([code]) => code === String(over.id))?.[1] : null;
            return label ? `Dropped in ${label}.` : "Move cancelled.";
          },
          onDragCancel() {
            return "Move cancelled.";
          },
        },
      }}
    >
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2" aria-label="Job pipeline">
        {JOB_PIPELINE.map(([status, label]) => (
          <KanbanColumn
            key={status}
            status={status}
            label={label}
            jobs={jobs.filter((job) => job.status === status)}
            canEdit={canEdit}
            onMove={onMove}
          />
        ))}
      </div>
      <DragOverlay>{active ? <JobKanbanCard job={active} canEdit={false} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({
  status,
  label,
  jobs,
  canEdit,
  onMove,
}: {
  status: string;
  label: string;
  jobs: JobSummary[];
  canEdit: boolean;
  onMove: (jobId: string, status: string) => Promise<void>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: !canEdit });
  return (
    <section className={cn("w-[min(18rem,82vw)] shrink-0 snap-start rounded-3xl border border-line bg-muted p-3", isOver && "ring-2 ring-ring")} aria-labelledby={`column-${status}`}>
      <h2 id={`column-${status}`} className="px-1 text-sm font-semibold text-foreground">{label}</h2>
      <p className="px-1 text-xs text-muted-foreground">{jobs.length}</p>
      <ul ref={setNodeRef} className="mt-3 min-h-28 space-y-2">
        {jobs.map((job) => (
          <li key={job.id}>
            <JobKanbanCard job={job} canEdit={canEdit} onMove={onMove} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function JobKanbanCard({
  job,
  canEdit,
  onMove,
  overlay = false,
}: {
  job: JobSummary;
  canEdit: boolean;
  onMove?: (jobId: string, status: string) => Promise<void>;
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: job.id, disabled: !canEdit || overlay });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  return (
    <Card
      ref={overlay ? undefined : setNodeRef}
      style={style}
      className={cn("gap-0 rounded-2xl bg-card py-0 shadow-sm", isDragging && "opacity-40", overlay && "shadow-lg")}
    >
      <CardContent className="space-y-2 p-3">
        <div className="flex items-start gap-2">
          {canEdit ? (
            <button
              type="button"
              className="mt-0.5 inline-flex size-11 shrink-0 cursor-grab items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
              aria-label={`Drag ${job.customer_name}. Space to pick up, arrow keys to move, space to drop.`}
              suppressHydrationWarning
              {...listeners}
              {...attributes}
            >
              <GripVertical className="size-4" />
            </button>
          ) : null}
          <Link href={`/operations/jobs/${job.id}`} className="min-w-0 flex-1 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <p className="font-semibold text-foreground">{job.customer_name}</p>
            <p className="mt-1 text-xs text-muted-foreground">{job.cin7_order_number || job.cin7_number || "No order number"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{jobDate(job)}</p>
          </Link>
        </div>
        {canEdit && onMove ? (
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex min-h-11 items-center rounded-full px-2 text-sm font-semibold text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
              Move
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-72 w-56">
              {JOB_PIPELINE.map(([code, label]) => (
                <DropdownMenuItem key={code} disabled={code === job.status} onClick={() => void onMove(job.id, code)}>
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </CardContent>
    </Card>
  );
}

function JobsMonth({ jobs }: { jobs: JobSummary[] }) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  });
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const title = cursor.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const weeks = useMemo(() => monthWeeks(cursor.getUTCFullYear(), cursor.getUTCMonth()), [cursor]);
  const placed = jobs.filter((job) => jobSpan(job));
  const flat = weeks.flat();

  function moveFocus(from: string, offset: number) {
    const next = flat[flat.indexOf(from) + offset];
    if (!next) return;
    setActiveDay(next);
    document.getElementById(`job-day-${next}`)?.focus();
  }

  return (
    <div className="rounded-3xl border border-line bg-card px-3 py-5 sm:px-4">
      <div className="grid grid-cols-[2.75rem_1fr_2.75rem] items-center">
        <button type="button" className="flex size-11 items-center justify-center rounded-full outline-none hover:bg-mist focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Previous month" onClick={() => setCursor(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - 1, 1)))}>
          <ChevronLeft aria-hidden="true" className="size-5" />
        </button>
        <h2 className="text-center font-display text-2xl">{title}</h2>
        <button type="button" className="flex size-11 items-center justify-center rounded-full outline-none hover:bg-mist focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="Next month" onClick={() => setCursor(new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1)))}>
          <ChevronRight aria-hidden="true" className="size-5" />
        </button>
      </div>
      <div className="mt-4 grid grid-cols-7 text-center text-xs font-semibold text-grey" aria-hidden="true">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => <div key={label} className="py-2">{label.slice(0, 1)}</div>)}
      </div>
      <div className="space-y-3" role="grid" aria-label={`${title} jobs`}>
        {weeks.map((week) => (
          <div key={week[0]} role="row">
            <div className="grid grid-cols-7 text-center text-sm">
              {week.map((iso) => {
                const inMonth = iso.slice(0, 7) === monthKey(cursor);
                const dayJobs = placed.filter((job) => jobTouches(job, iso));
                return (
                  <button
                    key={iso}
                    id={`job-day-${iso}`}
                    type="button"
                    role="gridcell"
                    aria-selected={activeDay === iso}
                    aria-label={`${iso}, ${dayJobs.length} jobs`}
                    className={cn(
                      "mx-auto flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      inMonth ? "text-ink" : "text-grey",
                      activeDay === iso && "bg-primary text-primary-foreground",
                    )}
                    onClick={() => setActiveDay(iso)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowRight") { event.preventDefault(); moveFocus(iso, 1); }
                      if (event.key === "ArrowLeft") { event.preventDefault(); moveFocus(iso, -1); }
                      if (event.key === "ArrowDown") { event.preventDefault(); moveFocus(iso, 7); }
                      if (event.key === "ArrowUp") { event.preventDefault(); moveFocus(iso, -7); }
                    }}
                  >
                    {Number(iso.slice(8))}
                  </button>
                );
              })}
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
      {activeDay ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm font-semibold">{activeDay}</p>
          {placed.filter((job) => jobTouches(job, activeDay)).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing pencilled on this day.</p>
          ) : (
            <ul className="space-y-2">
              {placed.filter((job) => jobTouches(job, activeDay)).map((job) => (
                <li key={job.id}>
                  <Link href={`/operations/jobs/${job.id}`} className="block rounded-2xl bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground">
                    {job.customer_name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
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

function jobTouches(job: JobSummary, iso: string) {
  const span = jobSpan(job);
  if (!span) return false;
  return iso >= span.start && iso <= span.end;
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

function displayStatus(label: string) {
  if (!label) return label;
  if (label !== label.toLowerCase()) return label;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function jobDate(job: JobSummary) {
  if (job.requested_date) {
    return job.requested_end && job.requested_end !== job.requested_date
      ? `${formatDate(job.requested_date)} – ${formatDate(job.requested_end)}`
      : formatDate(job.requested_date);
  }
  return job.booked_date ? `Booked ${formatDate(job.booked_date)}` : "No date";
}

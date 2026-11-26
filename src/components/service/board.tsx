"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";
import { arrangeServiceVisit } from "@/features/service/actions";
import type { ServiceBoard, ServiceConflict, ServiceStop } from "@/features/service/queries";
import { conflictLabel, visitStatusLabel, visitTypeLabel } from "@/lib/service/model";
import { cn } from "@/lib/utils";

function cellId(resourceId: string | null, day: string) {
  return `${resourceId ?? "unassigned"}:${day}`;
}

function stopId(stop: ServiceStop) {
  return `${cellId(stop.resourceId, stop.day)}:${stop.id}`;
}

function parseId(id: string) {
  const [resourceId, day, visitId] = id.split(":");
  return {
    resourceId: resourceId === "unassigned" ? null : resourceId,
    day,
    visitId: visitId || null,
  };
}

export function ServiceBoardView({
  board,
  days,
  mode,
}: {
  board: ServiceBoard;
  days: { iso: string; label: string }[];
  mode: "day" | "week";
}) {
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [overlap, setOverlap] = useState<{ message: string; move: Parameters<typeof arrangeServiceVisit>[0] } | null>(null);
  const dragReady = useSyncExternalStore(() => () => {}, () => true, () => false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const rows = useMemo(
    () => [
      { id: null as string | null, name: "Unassigned" },
      ...board.people.map((person) => ({ id: person.id, name: person.name })),
    ],
    [board.people],
  );
  const byCell = useMemo(() => {
    const grouped = new Map<string, ServiceStop[]>();
    for (const stop of board.stops) {
      const key = cellId(stop.resourceId, stop.day);
      const list = grouped.get(key) ?? [];
      list.push(stop);
      grouped.set(key, list);
    }
    for (const list of grouped.values()) list.sort((a, b) => a.stopOrder - b.stopOrder || a.customerName.localeCompare(b.customerName));
    return grouped;
  }, [board.stops]);
  const active = board.stops.find((stop) => stopId(stop) === activeId) ?? null;

  async function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    if (!board.canEdit || !event.over || pending) return;
    const from = parseId(String(event.active.id));
    const over = parseId(String(event.over.id));
    if (!from.visitId || !from.day || !over.day) return;
    const source = byCell.get(cellId(from.resourceId, from.day)) ?? [];
    const targetKey = cellId(over.resourceId, over.day);
    const target = (cellId(from.resourceId, from.day) === targetKey ? source : byCell.get(targetKey) ?? [])
      .filter((stop) => stop.id !== from.visitId);
    const overIndex = over.visitId ? target.findIndex((stop) => stop.id === over.visitId) : target.length;
    const index = (overIndex < 0 ? target.length : overIndex) + 1;
    const samePlace = from.resourceId === over.resourceId && from.day === over.day
      && source.findIndex((stop) => stop.id === from.visitId) + 1 === index;
    if (samePlace) return;
    const move = {
      visitId: from.visitId,
      fromResourceId: from.resourceId,
      toResourceId: over.resourceId,
      day: over.day,
      index,
    };
    await place(move, false);
  }

  async function place(move: Parameters<typeof arrangeServiceVisit>[0], confirmOverlap: boolean) {
    setPending(true);
    const result = await arrangeServiceVisit({ ...move, confirmOverlap });
    setPending(false);
    if (!result.ok && result.overlap) {
      setOverlap({ message: result.message, move });
      return;
    }
    setOverlap(null);
    if (!result.ok) toast.error(result.message);
    router.refresh();
  }

  const warning = overlap ? (
    <div className="rounded-2xl border border-line bg-card p-4">
      <p className="font-semibold">{overlap.message}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="inline-flex min-h-11 items-center rounded-full bg-red px-4 text-sm font-semibold text-white" disabled={pending} onClick={() => void place(overlap.move, true)}>Keep this time</button>
        <button type="button" className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold" disabled={pending} onClick={() => setOverlap(null)}>Cancel</button>
      </div>
    </div>
  ) : null;

  const body = mode === "day"
    ? (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {rows.map((row) => (
          <Column
            key={row.id ?? "unassigned"}
            title={row.name}
            day={days[0]?.iso ?? board.from}
            resourceId={row.id}
            stops={byCell.get(cellId(row.id, days[0]?.iso ?? board.from)) ?? []}
            conflicts={board.conflicts.filter((item) => item.resourceId === row.id && item.day === (days[0]?.iso ?? board.from))}
            canEdit={board.canEdit && dragReady}
          />
        ))}
      </div>
    )
    : (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[64rem] border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-36 px-2 py-2 text-left text-xs font-semibold text-grey"> </th>
              {days.map((day) => (
                <th key={day.iso} className="px-2 py-2 text-left text-xs font-semibold">{day.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id ?? "unassigned"} className="border-t border-line align-top">
                <th className="px-2 py-2 text-left font-semibold">{row.name}</th>
                {days.map((day) => (
                  <td key={day.iso} className="px-2 py-2">
                    <Column
                      title=""
                      day={day.iso}
                      resourceId={row.id}
                      stops={byCell.get(cellId(row.id, day.iso)) ?? []}
                      conflicts={board.conflicts.filter((item) => item.resourceId === row.id && item.day === day.iso)}
                      canEdit={board.canEdit && dragReady}
                      compact
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  if (!dragReady || !board.canEdit) {
    return (
      <div className="space-y-4">
        {warning}
        {body}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {warning}
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(event: DragStartEvent) => setActiveId(String(event.active.id))}
      onDragEnd={(event) => void onDragEnd(event)}
      onDragCancel={() => setActiveId(null)}
    >
      {body}
      <DragOverlay>{active ? <StopCard stop={active} overlay /> : null}</DragOverlay>
    </DndContext>
    </div>
  );
}

function Column({
  title,
  day,
  resourceId,
  stops,
  conflicts,
  canEdit,
  compact = false,
}: {
  title: string;
  day: string;
  resourceId: string | null;
  stops: ServiceStop[];
  conflicts: ServiceConflict[];
  canEdit: boolean;
  compact?: boolean;
}) {
  const id = cellId(resourceId, day);
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !canEdit });
  return (
    <section
      ref={setNodeRef}
      className={cn(
        "min-h-24 rounded-2xl border border-line bg-card p-2",
        compact ? "min-w-36" : "w-72 shrink-0",
        isOver && "border-red",
      )}
    >
      {title ? <h2 className="px-1 py-1 text-sm font-semibold">{title}</h2> : null}
      {conflicts.length > 0 ? (
        <ul className="mb-2 space-y-1">
          {conflicts.map((conflict) => (
            <li key={`${conflict.kind}-${conflict.label}`}>
              {conflict.href ? (
                <Link href={conflict.href} className="block rounded-full bg-red/10 px-2 py-1 text-xs font-semibold text-red">
                  {conflictLabel(conflict.kind, conflict.label)}
                </Link>
              ) : (
                <span className="block rounded-full bg-red/10 px-2 py-1 text-xs font-semibold text-red">
                  {conflictLabel(conflict.kind, conflict.label)}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <SortableContext id={id} items={stops.map(stopId)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2">
          {stops.map((stop) => (
            <li key={stopId(stop)}>
              <SortableStop stop={stop} canEdit={canEdit} />
            </li>
          ))}
        </ul>
      </SortableContext>
    </section>
  );
}

function SortableStop({ stop, canEdit }: { stop: ServiceStop; canEdit: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stopId(stop),
    disabled: !canEdit,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && "opacity-40")}>
      <StopCard stop={stop} handle={canEdit ? { ...attributes, ...listeners } : undefined} />
    </div>
  );
}

function StopCard({
  stop,
  overlay = false,
  handle,
}: {
  stop: ServiceStop;
  overlay?: boolean;
  handle?: Record<string, unknown>;
}) {
  const window = stop.windowStart && stop.windowEnd ? `${stop.windowStart}–${stop.windowEnd}` : null;
  return (
    <article className={cn("rounded-2xl border border-line bg-paper p-3", overlay && "shadow-lg")}>
      <div className="flex items-start gap-2">
        {handle ? (
          <button type="button" className="mt-0.5 text-grey" aria-label="Drag stop" {...handle}>
            <GripVertical className="size-4" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <Link href={`/service/visits/${stop.id}`} className="block font-semibold hover:underline">
            {stop.stopOrder > 0 ? `${stop.stopOrder}. ` : ""}{stop.customerName}
          </Link>
          <p className="text-sm text-grey">
            {stop.postcode} · {visitTypeLabel(stop.visitType)} · {stop.durationMinutes} min
            {window ? ` · ${window}` : ""}
          </p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-grey">{visitStatusLabel(stop.status)}</p>
        </div>
      </div>
    </article>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";
import { saveServiceRoute } from "@/features/service/actions";
import type { RouteStopRow, ServicePerson } from "@/features/service/queries";
import { Button } from "@/components/pulse/ui";
import { Select } from "@/components/pulse/select-field";
import { multiStopLink } from "@/lib/maps/navigation";
import { DEPOT, describeRoute, planRoute, type RouteVisit } from "@/lib/service/route";
import { formatAddress, visitTypeLabel } from "@/lib/service/model";
import { cn } from "@/lib/utils";

function driveLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours <= 0) return `${mins} min`;
  if (mins === 0) return `${hours} h`;
  return `${hours} h ${mins} min`;
}

function toVisit(stop: RouteStopRow): RouteVisit | null {
  if (stop.latitude == null || stop.longitude == null) return null;
  return {
    id: stop.id,
    latitude: stop.latitude,
    longitude: stop.longitude,
    windowStart: stop.windowStart,
    windowEnd: stop.windowEnd,
    durationMinutes: stop.durationMinutes,
  };
}

export function RoutePlanner({
  day,
  engineerId,
  engineers,
  stops,
  canEdit,
}: {
  day: string;
  engineerId: string;
  engineers: ServicePerson[];
  stops: RouteStopRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [order, setOrder] = useState(stops.map((stop) => stop.id));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragReady = useSyncExternalStore(() => () => {}, () => true, () => false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const byId = useMemo(() => new Map(stops.map((stop) => [stop.id, stop])), [stops]);
  const ordered = order.flatMap((id) => {
    const stop = byId.get(id);
    return stop ? [stop] : [];
  });
  const described = useMemo(
    () => describeRoute(ordered.flatMap((stop) => {
      const visit = toVisit(stop);
      return visit ? [visit] : [];
    })),
    [ordered],
  );
  const flagged = new Map(described.flagged.map((flag) => [flag.id, flag.message]));
  const arrivals = new Map(described.arrivals.map((item) => [item.id, item.arrive]));
  const maps = multiStopLink(ordered.map((stop) => formatAddress(stop)));

  function open(nextDay: string, nextEngineer: string) {
    const params = new URLSearchParams();
    if (/^\d{4}-\d{2}-\d{2}$/.test(nextDay)) params.set("on", nextDay);
    if (nextEngineer) params.set("engineer", nextEngineer);
    router.push(`/service/routes?${params.toString()}`);
  }

  function onDragEnd(event: DragEndEvent) {
    if (!canEdit || !event.over || event.active.id === event.over.id) return;
    setOrder((current) => {
      const from = current.indexOf(String(event.active.id));
      const to = current.indexOf(String(event.over?.id));
      if (from < 0 || to < 0) return current;
      return arrayMove(current, from, to);
    });
  }

  function optimise() {
    const located = ordered.flatMap((stop) => {
      const visit = toVisit(stop);
      return visit ? [visit] : [];
    });
    const planned = planRoute(located);
    const missing = ordered.filter((stop) => stop.latitude == null || stop.longitude == null).map((stop) => stop.id);
    setOrder([...planned.order, ...missing]);
  }

  async function save() {
    setPending(true);
    setError(null);
    const result = await saveServiceRoute(engineerId, day, order);
    setPending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    toast.success(result.message);
    router.refresh();
  }

  const list = (
    <ul className="space-y-2">
      {ordered.map((stop, index) => (
        <SortableStop
          key={stop.id}
          stop={stop}
          index={index + 1}
          canEdit={canEdit && dragReady}
          arrive={arrivals.get(stop.id) ?? null}
          flag={stop.latitude == null || stop.longitude == null ? "No map point" : flagged.get(stop.id) ?? null}
        />
      ))}
    </ul>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="block text-sm font-semibold">Date</span>
          <input
            type="date"
            value={day}
            className="h-11 w-full rounded-2xl border border-line bg-field px-3 text-base"
            onChange={(event) => open(event.target.value, engineerId)}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="block text-sm font-semibold">Engineer</span>
          <Select value={engineerId} onChange={(event) => open(day, event.target.value)}>
            {engineers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </Select>
        </label>
      </div>
      {error ? <p className="text-sm font-semibold text-red">{error}</p> : null}
      {ordered.length === 0 ? <p className="text-sm text-grey">No stops</p> : null}
      {ordered.length > 0 ? (
        <p className="text-sm text-grey">{DEPOT.label} · {DEPOT.postcode}</p>
      ) : null}
      {dragReady && canEdit ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            {list}
          </SortableContext>
        </DndContext>
      ) : list}
      {described.legs.length > 0 ? (
        <div className="space-y-2 rounded-3xl border border-line bg-card p-4">
          <ul className="space-y-1 text-sm">
            {described.legs.map((leg) => (
              <li key={`${leg.fromId}-${leg.toId}`} className="break-words">
                {leg.fromId === DEPOT.id ? DEPOT.label : byId.get(leg.fromId)?.customerName ?? "Stop"}
                {" → "}
                {leg.toId === DEPOT.id ? DEPOT.label : byId.get(leg.toId)?.customerName ?? "Stop"}
                {" · "}
                {leg.miles.toFixed(1)} mi · {leg.minutes} min
              </li>
            ))}
          </ul>
          <p className="font-semibold">
            {described.totalMiles.toFixed(1)} mi · {driveLabel(described.totalMinutes)} · {described.label}
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canEdit ? <Button type="button" disabled={pending || ordered.length < 2} onClick={optimise}>Optimise</Button> : null}
        {canEdit ? <Button type="button" variant="secondary" disabled={pending || ordered.length === 0} onClick={() => void save()}>{pending ? "Saving" : "Save"}</Button> : null}
        {maps ? <a className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold" href={maps}>Google Maps</a> : null}
      </div>
    </div>
  );
}

function StopRow({
  stop,
  index,
  arrive,
  flag,
  handle,
}: {
  stop: RouteStopRow;
  index: number;
  arrive: string | null;
  flag: string | null;
  handle?: Record<string, unknown>;
}) {
  const window = stop.windowStart && stop.windowEnd ? `${stop.windowStart}–${stop.windowEnd}` : null;
  return (
    <div className="flex items-start gap-2">
      {handle ? (
        <button type="button" className="inline-flex min-h-11 min-w-11 items-center justify-center text-grey" aria-label="Drag stop" {...handle}>
          <GripVertical className="size-5" />
        </button>
      ) : null}
      <div className="min-w-0 flex-1">
        <Link href={`/service/visits/${stop.id}`} className="break-words font-semibold hover:underline">
          {index}. {stop.customerName}
        </Link>
        <p className="break-words text-sm text-grey">
          {stop.postcode || "No postcode"} · {visitTypeLabel(stop.visitType)} · {stop.durationMinutes} min
          {window ? ` · ${window}` : ""}
          {arrive ? ` · ${arrive}` : ""}
        </p>
        {flag ? <p className="text-sm font-semibold text-red">{flag}</p> : null}
      </div>
    </div>
  );
}

function DraggableStop({
  stop,
  index,
  arrive,
  flag,
}: {
  stop: RouteStopRow;
  index: number;
  arrive: string | null;
  flag: string | null;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stop.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <li ref={setNodeRef} style={style} className={cn("rounded-2xl border border-line bg-card p-3", isDragging && "opacity-40")}>
      <StopRow stop={stop} index={index} arrive={arrive} flag={flag} handle={{ ...attributes, ...listeners }} />
    </li>
  );
}

function SortableStop({
  stop,
  index,
  canEdit,
  arrive,
  flag,
}: {
  stop: RouteStopRow;
  index: number;
  canEdit: boolean;
  arrive: string | null;
  flag: string | null;
}) {
  if (!canEdit) {
    return (
      <li className="rounded-2xl border border-line bg-card p-3">
        <StopRow stop={stop} index={index} arrive={arrive} flag={flag} />
      </li>
    );
  }
  return <DraggableStop stop={stop} index={index} arrive={arrive} flag={flag} />;
}

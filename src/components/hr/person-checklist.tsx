"use client";

import { useActionState } from "react";
import { FormStatus } from "@/components/hr/form-status";
import { StartLeavingDialog } from "@/components/hr/start-leaving-dialog";
import { EmptyState } from "@/components/pulse/states";
import { TextLink } from "@/components/pulse/ui";
import { setChecklistItem } from "@/features/hr/joiner-actions";
import {
  checklistItemHref,
  formatLondonDate,
  formatLondonWhen,
  kindLabel,
  ownerLabel,
  type ChecklistView,
} from "@/lib/hr/checklists";

function ItemForm({ item, employeeId, done }: { item: string; employeeId: string; done: boolean }) {
  const [state, action, pending] = useActionState(setChecklistItem, null);
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <input type="hidden" name="item" value={item} />
      <input type="hidden" name="employee" value={employeeId} />
      <input type="hidden" name="done" value={done ? "no" : "yes"} />
      <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center justify-center rounded-full border border-line bg-card px-4 text-sm font-semibold disabled:opacity-60">
        {done ? "Undo" : "Done"}
      </button>
      <FormStatus state={state} />
    </form>
  );
}

export function PersonChecklist({
  employeeId,
  name,
  status,
  start,
  today,
  profileId,
  engineerResourceId,
  canEdit,
  mfa,
  checklists,
}: {
  employeeId: string;
  name: string;
  status: string;
  start: string;
  today: string;
  profileId: string | null;
  engineerResourceId: string | null;
  canEdit: boolean;
  mfa: boolean;
  checklists: ChecklistView[];
}) {
  if (mfa) return <p className="text-sm font-semibold">Turn on two-step sign-in to open this.</p>;
  return (
    <div className="space-y-4">
      {canEdit && status !== "leaver" ? (
        <StartLeavingDialog id={employeeId} name={name} defaultDate={today} start={start} />
      ) : null}
      {checklists.length === 0 ? <EmptyState title="No checklist yet" /> : checklists.map((list) => (
        <section key={list.id} className="space-y-2">
          <h2 className="font-display text-2xl">{kindLabel(list.kind)}</h2>
          <p className="text-sm text-grey">{list.status === "done" ? "Done" : "Open"} · {formatLondonDate(list.dueOn)}</p>
          <div className="rounded-3xl border border-line bg-card">
            <div className="hidden grid-cols-[minmax(0,1fr)_6rem_8rem_auto] gap-3 border-b border-line px-4 py-2 text-sm font-semibold text-grey sm:grid">
              <span>Item</span>
              <span>Owner</span>
              <span>Due</span>
              <span className="sr-only">Action</span>
            </div>
            <ul>
              {list.items.map((item) => {
                const link = checklistItemHref(item.linkKind, { profileId, engineerResourceId });
                return (
                  <li key={item.id} className="grid gap-2 border-b border-line px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_6rem_8rem_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="font-semibold">{item.label}</p>
                      {item.doneAt ? <p className="text-sm text-grey">Done {formatLondonWhen(item.doneAt)}</p> : null}
                      <p className="text-sm text-grey sm:hidden">{ownerLabel(item.owner)} · {formatLondonDate(item.dueOn)}</p>
                    </div>
                    <p className="hidden text-sm sm:block">{ownerLabel(item.owner)}</p>
                    <p className="hidden text-sm sm:block">{formatLondonDate(item.dueOn)}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {link ? <TextLink href={link.href} variant="ghost">{link.label}</TextLink> : null}
                      {canEdit ? <ItemForm item={item.id} employeeId={employeeId} done={Boolean(item.doneAt)} /> : (
                        <span className="text-sm">{item.doneAt ? "Done" : "Open"}</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
}

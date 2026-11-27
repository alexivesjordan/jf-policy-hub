"use client";

import { useActionState } from "react";
import { FormStatus } from "@/components/hr/form-status";
import { Button } from "@/components/pulse/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { startLeaving } from "@/features/hr/joiner-actions";

export function StartLeavingDialog({
  id,
  name,
  defaultDate,
  start,
}: {
  id: string;
  name: string;
  defaultDate: string;
  start: string;
}) {
  const [state, action, pending] = useActionState(startLeaving, null);
  return (
    <Dialog>
      <DialogTrigger
        type="button"
        className="inline-flex min-h-11 items-center justify-center rounded-full border border-destructive bg-transparent px-4 text-base font-semibold text-foreground hover:bg-destructive/10"
      >
        Start leaving
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set {name} as a leaver?</DialogTitle>
          <DialogDescription>Leave date</DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="name" value={name} />
          <input type="hidden" name="confirm" value={name} />
          <label className="block text-sm font-semibold">
            Leave date
            <input
              className="mt-1 h-11 w-full rounded-2xl border border-line bg-field px-3"
              type="date"
              name="end"
              required
              defaultValue={defaultDate}
              min={start || undefined}
              aria-label="Leave date"
            />
          </label>
          <Button type="submit" variant="danger" disabled={pending}>
            {pending ? "Saving…" : `Set ${name} as a leaver`}
          </Button>
          <FormStatus state={state} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

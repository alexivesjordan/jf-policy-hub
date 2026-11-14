"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banner, Button, Field, TextArea } from "@/components/pulse/ui";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cancelInstall } from "@/features/sales/install-actions";

export function CancelBookingButton({ installId }: { installId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const trimmed = reason.trim();
  const ready = trimmed.length >= 3 && trimmed.length <= 500;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="danger" />}>Cancel booking</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">Cancel booking</DialogTitle>
          <DialogDescription>This frees the dates and stops the access link. The customer is not emailed.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            setPending(true);
            void cancelInstall(installId, trimmed).then((result) => {
              setMessage(result.message);
              setPending(false);
              if (result.ok) {
                setOpen(false);
                router.refresh();
              }
            });
          }}
        >
          <Field label="Reason">
            <TextArea required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
          {message ? <Banner tone="error">{message}</Banner> : null}
          <DialogFooter>
            <Button type="submit" variant="danger" disabled={!ready || pending}>{pending ? "Cancelling..." : "Cancel booking"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

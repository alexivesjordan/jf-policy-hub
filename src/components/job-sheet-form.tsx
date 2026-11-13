"use client";

import { useActionState } from "react";
import { Banner, Button, Field, Input, TextArea } from "@/components/pulse/ui";
import { submitJobSheet } from "@/features/subcontractors/quote-actions";

export function JobSheetForm({ token, installId, orderNo, address }: { token: string; installId: string; orderNo: string; address: string }) {
  const [state, action, pending] = useActionState(submitJobSheet, null);
  if (state?.ok) return <Banner tone="success">{state.message}</Banner>;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="installId" value={installId} />
      <input type="hidden" name="orderNo" value={orderNo} />
      <input type="hidden" name="address" value={address} />
      <Field label="Your name"><Input name="engineerName" required /></Field>
      <Field label="Work carried out"><TextArea name="workCarriedOut" /></Field>
      {state ? <Banner tone="error">{state.message}</Banner> : null}
      <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Submit job sheet"}</Button>
    </form>
  );
}

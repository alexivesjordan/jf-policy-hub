"use client";

import { useActionState } from "react";
import { generateServiceProposal } from "@/features/sales/service-actions";
import { Banner, Button } from "@/components/pulse/ui";

export { ServiceQuoteResult } from "@/components/service-quote-view";

export function ProposalButton({ quoteId }: { quoteId: string | null }) {
  const [state, action, pending] = useActionState(generateServiceProposal, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="serviceQuoteId" value={quoteId ?? ""} />
      <Button type="submit" variant="secondary" disabled={pending || !quoteId}>{pending ? "Creating the proposal…" : "Generate proposal"}</Button>
      {state && !state.ok ? <Banner tone="error">{state.message}</Banner> : null}
      {state?.downloadUrl ? (
        <p className="text-sm">
          <a className="font-semibold underline decoration-primary" href={state.downloadUrl}>Download the proposal</a>
          <span className="text-grey"> · the link lasts 10 minutes</span>
        </p>
      ) : null}
    </form>
  );
}

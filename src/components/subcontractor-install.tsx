"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banner, Button, Field, Input } from "@/components/pulse/ui";
import { SubcontractorQuote } from "@/components/subcontractor-quote";
import { awardSubcontractor, confirmSubcontractorPrice, resendFailedQuote, resendJobSheet, type AskAnotherOffer } from "@/features/subcontractors/quote-actions";
import { isWeekday } from "@/lib/subcontractors/draft";

type Message = { id: string; direction: string; from: string | null; body: string | null; delivery: string | null; suggestedPrice: number | null; bodyUnavailable?: boolean };
type Thread = { id: string; subcontractorId: string; name: string; status: string; suggestedPrice: number | null; confirmedPrice: number | null; messages: Message[] };

export function SubcontractorInstall({ installId, stage, status, subcontractorName, threads, canAward, followup = null }: { installId: string; stage: string; status: string; subcontractorName: string | null; threads: Thread[]; canAward: boolean; followup?: AskAnotherOffer | null }) {
  if (threads.length === 0 && stage !== "quoting" && !subcontractorName) return null;
  return (
    <section className="space-y-4 rounded-3xl border border-line bg-card px-5 py-5">
      <h2 className="font-display text-2xl">Subcontractors</h2>
      {subcontractorName ? <p className="text-sm">Chosen: {subcontractorName}</p> : null}
      {stage === "quoting" ? <p className="text-sm text-grey">Quoting. Assembly and QC still go on the Jordan calendar when you award the job.</p> : null}
      {threads.map((thread) => <ThreadCard key={thread.id} installId={installId} thread={thread} canAward={canAward && stage === "quoting"} />)}
      {followup ? (
        <details className="rounded-2xl border border-line px-3 py-3">
          <summary className="cursor-pointer text-sm font-semibold">Ask another subcontractor</summary>
          <SubcontractorQuote offer={followup} embedded />
        </details>
      ) : null}
      {subcontractorName && status !== "cancelled" && status !== "completed" ? <JobSheetButton installId={installId} /> : null}
    </section>
  );
}

function ThreadCard({ installId, thread, canAward }: { installId: string; thread: Thread; canAward: boolean }) {
  const router = useRouter();
  const suggestion = [...thread.messages].reverse().find((item) => item.suggestedPrice != null)?.suggestedPrice ?? thread.suggestedPrice;
  const [price, setPrice] = useState(thread.confirmedPrice != null ? String(thread.confirmedPrice) : suggestion != null ? String(suggestion) : "");
  const [customerPrice, setCustomerPrice] = useState("");
  const [start, setStart] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  return (
    <article className="space-y-3 rounded-2xl border border-line px-3 py-3 text-sm">
      <p className="font-semibold">{thread.name} · {threadLabel(thread.status)}</p>
      {thread.status === "failed" ? (
        <Button type="button" variant="secondary" disabled={pending} onClick={async () => {
          setPending(true);
          const result = await resendFailedQuote(thread.id);
          setMessage(result?.message ?? "Could not resend that quote.");
          setPending(false);
          if (result?.ok) router.refresh();
        }}>Resend</Button>
      ) : null}
      {suggestion != null ? <p>Suggested price {money(suggestion)}. Confirm it before awarding.</p> : <p className="text-grey">No suggested price yet.</p>}
      {thread.confirmedPrice != null ? <p>Confirmed {money(thread.confirmedPrice)}</p> : null}
      <ul className="space-y-2">
        {thread.messages.map((item) => (
          <li key={item.id} className="rounded-xl bg-muted px-3 py-2">
            <p className="text-grey">{item.direction === "in" ? "Reply" : "Sent"}{item.delivery ? ` · ${item.delivery}` : ""}{item.from ? ` · ${item.from}` : ""}</p>
            {item.bodyUnavailable ? <p className="mt-1 font-semibold">Body unavailable</p> : null}
            {item.body ? <p className="mt-1 whitespace-pre-wrap">{item.body}</p> : null}
          </li>
        ))}
      </ul>
      {canAward ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Subcontractor price"><Input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" /></Field>
          <div className="md:col-span-2"><Button type="button" variant="secondary" disabled={pending} onClick={async () => { setPending(true); const result = await confirmSubcontractorPrice(thread.id, price); setMessage(result?.message ?? "Could not confirm that price."); setPending(false); if (result?.ok) router.refresh(); }}>Confirm price</Button></div>
          <Field label="Customer price" hint="Subcontractor jobs carry almost no markup."><Input value={customerPrice} onChange={(event) => setCustomerPrice(event.target.value)} inputMode="decimal" /></Field>
          <Field label="Assembly and QC start" hint="Weekdays only."><Input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></Field>
          <div className="md:col-span-2">
            <Button type="button" disabled={pending || thread.confirmedPrice == null} onClick={async () => {
              if (!isWeekday(start)) { setMessage("Choose a weekday start date."); return; }
              setPending(true);
              const result = await awardSubcontractor(installId, thread.subcontractorId, customerPrice, start);
              setMessage(result.jobSheetUrl ? `${result.message} ${result.jobSheetUrl}` : result.message);
              setPending(false);
              if (result.ok) router.refresh();
            }}>Award and book</Button>
          </div>
        </div>
      ) : null}
      {message ? <p>{message}</p> : null}
    </article>
  );
}

function JobSheetButton({ installId }: { installId: string }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <div className="space-y-2">
      <Button type="button" variant="secondary" disabled={pending} onClick={async () => {
        setPending(true);
        const result = await resendJobSheet(installId);
        setMessage(result.jobSheetUrl ? `${result.message} ${result.jobSheetUrl}` : result.message);
        setPending(false);
      }}>{pending ? "Sending…" : "Send job sheet link"}</Button>
      {message ? <Banner tone="success">{message}</Banner> : null}
    </div>
  );
}

function threadLabel(status: string) {
  if (status === "replied") return "Replied";
  if (status === "chosen") return "Chosen";
  if (status === "declined") return "Not chosen";
  if (status === "sent") return "Sent";
  return "Queued";
}

function money(value: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

import { Suspense } from "react";
import { connection } from "next/server";
import { JobSheetForm } from "@/components/job-sheet-form";
import { hashPulseToken } from "@/lib/pulse/token-hash";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Job sheet" };

export default function JobSheetPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<main className="mx-auto min-h-screen max-w-lg px-4 py-8"><p>Loading the job sheet...</p></main>}>
      <JobSheet params={params} />
    </Suspense>
  );
}

async function JobSheet({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const hash = hashPulseToken(token);
  const admin = createAdminClient();
  if (!hash || !admin) return <Invalid />;
  const preview = await admin.rpc("install_job_preview", { p_token_hash: hash });
  const job = preview.data as { installId?: string; orderNumber?: string; customerName?: string; siteAddress?: string | null; startOn?: string | null; endOn?: string | null; lines?: { qty?: string; description?: string }[] } | null;
  if (!job?.installId) return <Invalid />;
  return (
    <main className="mx-auto min-h-screen max-w-lg space-y-6 bg-paper px-4 py-8 text-ink">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-grey">Jordan Fitness</p>
      <h1 className="font-display text-4xl">Job sheet</h1>
      <dl className="space-y-2 text-sm">
        <div><dt className="text-grey">Order</dt><dd className="font-semibold">{job.orderNumber}</dd></div>
        <div><dt className="text-grey">Customer</dt><dd className="font-semibold">{job.customerName}</dd></div>
        <div><dt className="text-grey">Site</dt><dd className="font-semibold">{job.siteAddress || "Not set"}</dd></div>
        <div><dt className="text-grey">Dates</dt><dd className="font-semibold">{[job.startOn, job.endOn].filter(Boolean).join(" – ") || "Not set"}</dd></div>
      </dl>
      <ul className="space-y-1 text-sm">{(job.lines ?? []).map((line, index) => <li key={index}>{line.qty}× {line.description}</li>)}</ul>
      <JobSheetForm token={token} installId={job.installId} orderNo={job.orderNumber ?? ""} address={job.siteAddress ?? ""} />
    </main>
  );
}

function Invalid() {
  return <main className="mx-auto min-h-screen max-w-lg px-4 py-8"><h1 className="font-display text-4xl">That link is not valid</h1></main>;
}

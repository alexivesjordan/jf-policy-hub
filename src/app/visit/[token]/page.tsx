import { connection } from "next/server";
import { Suspense } from "react";
import { FieldFrame } from "@/components/field/frame";
import { VisitFlow, type VisitScreen } from "@/components/field/visit-flow";
import { riskFromUnknown, type OrderLineView } from "@/lib/installs/visit-form";
import { hashPulseToken } from "@/lib/pulse/token-hash";
import { createAdminClient } from "@/lib/supabase/admin";

export const instant = false;
export const metadata = { title: "Job sheet" };

export default function VisitTokenPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<FieldFrame title="Job sheet"><p className="text-grey">Loading...</p></FieldFrame>}>
      <TokenVisit params={params} />
    </Suspense>
  );
}

async function TokenVisit({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const hash = hashPulseToken(token);
  const admin = createAdminClient();
  if (!hash || !admin) return <Invalid />;
  const preview = await admin.rpc("install_visit_preview", { p_token_hash: hash });
  const data = preview.data as {
    submitted?: boolean;
    lines?: OrderLineView[];
    risk?: { answers?: unknown } | null;
    job?: {
      id: string;
      orderNumber: string;
      customerName: string;
      siteAddress: string | null;
      contactName: string | null;
      contactPhone: string | null;
      startOn: string;
      status: string;
    };
  } | null;
  if (preview.error || !data?.job?.id) return <Invalid />;
  const vansResult = await admin.rpc("install_list_vans");
  const vans = Array.isArray(vansResult.data)
    ? (vansResult.data as { registration?: string; name?: string | null }[]).flatMap((van) => (van?.registration ? [{ registration: van.registration, name: van.name ?? null }] : []))
    : [];
  const screen: VisitScreen = {
    installId: data.job.id,
    token,
    canInvite: false,
    customerName: data.job.customerName,
    siteAddress: data.job.siteAddress,
    contactName: data.job.contactName ?? data.job.customerName,
    phone: data.job.contactPhone ?? "",
    address: data.job.siteAddress ?? "",
    orderNo: data.job.orderNumber,
    startOn: data.job.startOn,
    lines: Array.isArray(data.lines) ? data.lines : [],
    vans,
    risk: riskFromUnknown(data.risk?.answers),
    submitted: Boolean(data.submitted) || data.job.status === "completed",
    engineerName: "",
    signatureUrl: null,
    signatureFileId: null,
  };
  return (
    <FieldFrame title={data.job.orderNumber}>
      <p className="mb-4 text-sm text-grey">No login needed.</p>
      <VisitFlow screen={screen} />
    </FieldFrame>
  );
}

function Invalid() {
  return (
    <FieldFrame title="Job sheet">
      <h2 className="font-display text-3xl">That link is not valid</h2>
      <p className="mt-3 text-base">Ask Jordan Fitness for a new job link.</p>
    </FieldFrame>
  );
}

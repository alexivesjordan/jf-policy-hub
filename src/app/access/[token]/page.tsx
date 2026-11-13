import { Suspense } from "react";
import { connection } from "next/server";
import { AccessForm } from "@/components/access-form";
import { hashPulseToken } from "@/lib/pulse/token-hash";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Site access" };

export default function AccessPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<AccessFallback />}>
      <AccessContent params={params} />
    </Suspense>
  );
}

function AccessFallback() {
  return (
    <main className="mx-auto min-h-screen max-w-lg bg-paper px-4 py-8">
      <Brand />
      <h1 className="font-display mt-3 text-4xl">Site access</h1>
    </main>
  );
}

async function AccessContent({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const hash = hashPulseToken(token);
  const admin = createAdminClient();
  if (!hash || !admin) return <Invalid />;
  const installPreview = await admin.rpc("install_access_preview", { p_token_hash: hash });
  const install = installPreview.data as { install_id?: string; customer_name?: string; submitted?: boolean } | null;
  const terms = await admin.rpc("orbit_read_terms");
  const lines = ((terms.data as { charges_grid?: { lines?: { label?: string; rate?: number; unit?: string; basis?: string; mileage?: number }[] }; version_label?: string } | null)?.charges_grid?.lines ?? []);
  const versionLabel = (terms.data as { version_label?: string } | null)?.version_label ?? "current";
  if (install?.customer_name && install.install_id) {
    const saved = install.submitted ? await savedSubmission(admin, install.install_id) : null;
    return (
      <main className="mx-auto min-h-screen max-w-lg bg-paper px-4 py-8">
        <Brand />
        <h1 className="font-display mt-3 text-4xl">Site access</h1>
        <p className="mt-2 text-sm font-semibold">{install.customer_name}</p>
        <div className="mt-6">
          <AccessForm token={token} versionLabel={versionLabel} lines={lines} submitted={Boolean(install.submitted)} saved={saved} />
        </div>
      </main>
    );
  }
  const preview = await admin.rpc("orbit_access_preview", { p_token_hash: hash });
  const data = preview.data as {
    customer_name?: string;
    postcode?: string | null;
    terms?: { version_label: string; lines: { label?: string; rate?: number; unit?: string; basis?: string; mileage?: number }[] } | null;
  } | null;
  if (preview.error || !data?.customer_name) return <Invalid />;
  return (
    <main className="mx-auto min-h-screen max-w-lg bg-paper px-4 py-8">
      <Brand />
      <h1 className="font-display mt-3 text-4xl">Site access</h1>
      <p className="mt-2 text-sm font-semibold">{data.customer_name}{data.postcode ? ` · ${data.postcode}` : ""}</p>
      <div className="mt-6">
        <AccessForm token={token} versionLabel={data.terms?.version_label ?? versionLabel} lines={data.terms?.lines ?? lines} />
      </div>
    </main>
  );
}

async function savedSubmission(admin: NonNullable<ReturnType<typeof createAdminClient>>, installId: string) {
  const client = admin as unknown as { schema?: (name: string) => { from: (table: string) => Query } };
  if (!client.schema) return null;
  try {
    const listed = await client.schema("ops").from("access_submissions").select("answers, accepted_by_name, media_file_ids").eq("install_id", installId).order("created_at", { ascending: false }).limit(1);
    const row = Array.isArray(listed.data) ? listed.data[0] as { answers?: Record<string, unknown>; accepted_by_name?: string; media_file_ids?: string[] } : null;
    if (!row) return null;
    return { acceptedName: row.accepted_by_name ?? null, answers: row.answers ?? null, media: [] as { id: string; url?: string | null; mime?: string | null; kind?: string | null }[] };
  } catch {
    return null;
  }
}

type Query = {
  select: (query: string) => {
    eq: (column: string, value: string) => {
      order: (column: string, options: { ascending: boolean }) => { limit: (count: number) => Promise<{ data: unknown }> };
    };
  };
};

function Brand() {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-grey">Jordan Fitness</p>
      <p className="font-display text-2xl text-ink">Jordan Pulse</p>
    </div>
  );
}

function Invalid() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center bg-paper px-4">
      <Brand />
      <h1 className="font-display mt-4 text-4xl">That link is not valid</h1>
      <p className="mt-3 text-ink/70">Ask Jordan Fitness for a new access link.</p>
    </main>
  );
}

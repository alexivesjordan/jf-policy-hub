import { Suspense } from "react";
import { connection } from "next/server";
import { AccessForm } from "@/components/access-form";
import { hashOrbitToken } from "@/lib/orbit/token-hash";
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
    <main className="mx-auto min-h-screen max-w-lg px-4 py-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-grey">Jordan Fitness</p>
      <h1 className="font-display mt-2 text-4xl">Site access</h1>
      <p className="mt-6 text-white/70">Loading the form...</p>
    </main>
  );
}

async function AccessContent({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const hash = hashOrbitToken(token);
  const admin = createAdminClient();
  if (!hash || !admin) {
    return <Invalid />;
  }
  const preview = await admin.rpc("orbit_access_preview", { p_token_hash: hash });
  const data = preview.data as {
    customer_name?: string;
    postcode?: string | null;
    terms?: { version_label: string; lines: { label?: string; rate?: number; unit?: string; basis?: string; mileage?: number }[] } | null;
  } | null;
  if (preview.error || !data?.customer_name) return <Invalid />;

  return (
    <main className="mx-auto min-h-screen max-w-lg px-4 py-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-grey">Jordan Fitness</p>
      <h1 className="font-display mt-2 text-4xl">Site access</h1>
      <p className="mt-2 text-white/70">
        {data.customer_name}
        {data.postcode ? ` · ${data.postcode}` : ""}. No account is needed.
      </p>
      <div className="mt-6">
        <AccessForm
          token={token}
          versionLabel={data.terms?.version_label ?? "unversioned"}
          lines={data.terms?.lines ?? []}
        />
      </div>
    </main>
  );
}

function Invalid() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4">
      <h1 className="font-display text-4xl">That link is not valid</h1>
      <p className="mt-3 text-white/70">Ask Jordan Fitness for a new access link.</p>
    </main>
  );
}

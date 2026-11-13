import { Suspense } from "react";
import { connection } from "next/server";
import { AccessForm } from "@/components/access-form";
import { loadInstallAccessPreview } from "@/lib/installs/access-preview";
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
  const install = await loadInstallAccessPreview(token);
  if (install?.install_id) {
    const saved = install.submitted
      ? {
          acceptedName: install.accepted_by_name,
          answers: install.answers,
          media: install.media.map((item) => ({ id: item.id, url: item.url, mime: item.mime, kind: item.kind })),
        }
      : null;
    return (
      <main className="mx-auto min-h-screen max-w-lg bg-paper px-4 py-8">
        <Brand />
        <h1 className="font-display mt-3 text-4xl">Site access</h1>
        {install.customer_name ? <p className="mt-2 text-sm font-semibold">{install.customer_name}</p> : null}
        {install.site_address ? <p className="text-sm text-grey">{install.site_address}</p> : null}
        <div className="mt-6">
          <AccessForm
            token={token}
            versionLabel={install.terms?.version_label ?? "current"}
            lines={install.terms?.lines ?? []}
            submitted={install.submitted}
            saved={saved}
          />
        </div>
      </main>
    );
  }

  const hash = hashPulseToken(token);
  const admin = createAdminClient();
  if (!hash || !admin) return <Invalid />;
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
        <AccessForm token={token} versionLabel={data.terms?.version_label ?? "current"} lines={data.terms?.lines ?? []} />
      </div>
    </main>
  );
}

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

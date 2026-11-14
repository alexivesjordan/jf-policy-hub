import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { FieldFrame } from "@/components/field/frame";
import { SignatureForm } from "@/components/field/signature-form";
import { mySignature } from "@/features/field/queries";
import { getCurrentProfile } from "@/lib/auth";
import { isFixtureMode, isSupabaseConfigured } from "@/lib/env";

export const instant = false;
export const metadata = { title: "My signature" };

export default function SignaturePage() {
  return (
    <Suspense fallback={<FieldFrame title="Signature" back={{ href: "/field", label: "Jobs" }}><p className="text-grey">Loading...</p></FieldFrame>}>
      <Signature />
    </Suspense>
  );
}

async function Signature() {
  await connection();
  if (!isSupabaseConfigured() && !isFixtureMode()) {
    return <FieldFrame title="Signature" back={{ href: "/field", label: "Jobs" }}><p>Add the Supabase keys, then save a signature.</p></FieldFrame>;
  }
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/field/signature");
  if (!profile.access_granted) redirect("/no-access");
  if (!profile.is_active) redirect("/account-inactive");
  const existing = await mySignature().catch(() => null);
  return (
    <FieldFrame title="Signature" back={{ href: "/field", label: "Jobs" }}>
      <p className="mb-4 text-base">Draw it once. It is ready on your jobs.</p>
      <SignatureForm existingUrl={existing?.url ?? null} />
      <Link href="/account/name" className="mt-6 inline-flex min-h-12 items-center text-base font-semibold underline decoration-red">
        Your name
      </Link>
    </FieldFrame>
  );
}

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { signOut } from "@/features/auth/actions";
import { getCurrentProfile } from "@/lib/auth";

export const metadata = { title: "Account inactive" };

export default function InactivePage() {
  return (
    <Suspense fallback={<main className="px-6 py-16">Loading...</main>}>
      <InactiveContent />
    </Suspense>
  );
}

async function InactiveContent() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.is_active) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <p className="text-sm font-semibold uppercase tracking-wide text-yellow">Jordan Orbit</p>
      <h1 className="font-display mt-2 text-4xl">This account is switched off</h1>
      <p className="mt-3 leading-7 text-ink/80">
        An administrator has deactivated {profile.email}. Ask them to turn it back on if you still need access.
      </p>
      <form action={signOut} className="mt-6">
        <button type="submit" className="rounded-full bg-yellow px-4 py-2 font-semibold text-[#0D0D0D]">
          Sign out
        </button>
      </form>
    </main>
  );
}

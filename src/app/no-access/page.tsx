import { Suspense } from "react";
import { redirect } from "next/navigation";
import { signOut } from "@/features/auth/actions";
import { accessRedirect, canUsePeople, isCompanyEmail } from "@/lib/access";
import { getCurrentProfile } from "@/lib/auth";

export const metadata = { title: "No access" };

export default function NoAccessPage() {
  return (
    <Suspense fallback={<main className="px-6 py-16 text-grey">Loading...</main>}>
      <NoAccessContent />
    </Suspense>
  );
}

async function NoAccessContent() {
  const profile = await getCurrentProfile();
  const destination = accessRedirect(profile);
  if (destination !== "/no-access") redirect(destination ?? "/");
  if (!profile) redirect("/login");

  const wrongDomain = !isCompanyEmail(profile.email);
  const moduleOff = profile.access_granted && profile.is_active && !canUsePeople(profile);
  const message = wrongDomain
    ? `Jordan Orbit is for @jordanfitness.com accounts. ${profile.email} cannot be given access.`
    : moduleOff
      ? "Orbit People is not switched on for your account. Ask an administrator if you still need it."
      : "You do not have access to Jordan Orbit yet. Ask an administrator to invite you.";

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <p className="text-sm font-semibold uppercase tracking-wide text-grey">Jordan Orbit</p>
      <h1 className="font-display mt-2 text-4xl">No access yet</h1>
      <p className="mt-3 leading-7 text-grey">{message}</p>
      <p className="mt-2 text-sm text-ink">{profile.email}</p>
      <form action={signOut} className="mt-6">
        <button type="submit" className="rounded-full bg-red px-4 py-2 font-semibold text-white">
          Sign out
        </button>
      </form>
    </main>
  );
}

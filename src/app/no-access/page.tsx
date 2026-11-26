import { Suspense } from "react";
import { redirect } from "next/navigation";
import { signOut } from "@/features/auth/actions";
import { accessRedirect, canManageWorkspace, canUsePeople, isCompanyEmail } from "@/lib/access";
import { getCurrentProfile } from "@/lib/auth";
import { oneParam } from "@/lib/utils";

export const metadata = { title: "No access" };

export default function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<main className="px-6 py-16 text-grey">Loading...</main>}>
      <NoAccessContent searchParams={searchParams} />
    </Suspense>
  );
}

async function NoAccessContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await getCurrentProfile();
  const reason = oneParam((await searchParams).reason);
  const workspaceDenied = reason === "workspace" && Boolean(profile?.access_granted && profile.is_active && !canManageWorkspace(profile));
  if (!workspaceDenied) {
    const destination = accessRedirect(profile);
    if (destination !== "/no-access") redirect(destination ?? "/");
  }
  if (!profile) redirect("/login");

  const wrongDomain = !isCompanyEmail(profile.email);
  const moduleOff = profile.access_granted && profile.is_active && !canUsePeople(profile);
  const message = workspaceDenied
    ? "You do not have access to Workspace."
    : wrongDomain
      ? `Jordan Pulse is for @jordanfitness.com accounts. ${profile.email} cannot be given access.`
      : moduleOff
        ? "Pulse People is not switched on for your account. Ask an administrator if you still need it."
        : "You do not have access to Jordan Pulse yet. Ask an administrator to invite you.";

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <p className="text-sm font-semibold uppercase tracking-wide text-grey">Jordan Pulse</p>
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

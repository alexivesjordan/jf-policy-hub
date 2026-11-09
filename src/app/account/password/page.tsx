import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SetPasswordForm } from "@/components/password-forms";
import { accessRedirect } from "@/lib/access";
import { getCurrentProfile } from "@/lib/auth";
import { oneParam } from "@/lib/utils";

export const metadata = { title: "Password" };

export default function PasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<main className="px-6 py-16 text-grey">Loading...</main>}>
      <PasswordContent searchParams={searchParams} />
    </Suspense>
  );
}

async function PasswordContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/account/password");

  const params = await searchParams;
  const setup = oneParam(params.setup) === "1";
  const saved = oneParam(params.saved) === "1";
  const home = accessRedirect(profile);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-grey">Jordan Orbit</p>
      <h1 className="font-display mt-2 text-4xl">{setup ? "Choose a password" : "Change password"}</h1>
      <p className="mt-3 leading-7 text-grey">
        {setup
          ? "You will use this password the next time you sign in."
          : "Choose a new password for your Jordan Fitness account."}
      </p>
      {saved ? <p className="mt-4 text-sm text-ink">Password saved.</p> : null}
      <div className="mt-6">
        <SetPasswordForm next={setup ? "/" : "/account/password?saved=1"} setup={setup} />
      </div>
      {home === null ? (
        <p className="mt-6 text-sm">
          <Link href="/" className="font-semibold text-ink underline decoration-red underline-offset-4">
            Back to Jordan Orbit
          </Link>
        </p>
      ) : null}
    </main>
  );
}

import { Suspense } from "react";
import { Input } from "@/components/pulse/ui";
import { Button } from "@/components/ui/button";
import { updateOwnName } from "@/features/account/name-actions";
import { getCurrentProfile } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata = { title: "Your name" };

export default function AccountNamePage() {
  return (
    <Suspense fallback={<main className="px-6 py-16 text-grey">Loading...</main>}>
      <AccountNameForm />
    </Suspense>
  );
}

async function AccountNameForm() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/account/name");

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-grey">Jordan Pulse</p>
      <h1 className="font-display mt-2 text-4xl">Your name</h1>
      <form action={updateOwnName} className="mt-6 space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block text-grey">First name</span>
          <Input name="firstName" required defaultValue={profile.first_name ?? ""} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-grey">Last name</span>
          <Input name="lastName" required defaultValue={profile.last_name ?? ""} />
        </label>
        <Button type="submit">Save name</Button>
      </form>
    </main>
  );
}

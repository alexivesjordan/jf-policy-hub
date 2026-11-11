import { Suspense } from "react";
import { Button, Field, Input } from "@/components/pulse/ui";
import { updateOwnName } from "@/features/account/name-actions";
import { getCurrentProfile } from "@/lib/auth";
import { splitPersonName } from "@/lib/names";
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
  const stored = splitPersonName(profile.full_name);
  const firstName = profile.first_name || stored.firstName;
  const lastName = profile.last_name || stored.lastName;

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <p className="text-sm font-semibold uppercase tracking-wide text-grey">Jordan Pulse</p>
      <h1 className="font-display mt-2 text-4xl">Your name</h1>
      <form action={updateOwnName} className="mt-6 space-y-4">
        <Field label="First name">
          <Input name="firstName" required defaultValue={firstName} autoComplete="given-name" />
        </Field>
        <Field label="Last name">
          <Input name="lastName" required defaultValue={lastName} autoComplete="family-name" />
        </Field>
        <Button type="submit">Save name</Button>
      </form>
    </main>
  );
}
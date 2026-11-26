import Link from "next/link";
import { Button, Field, Input } from "@/components/pulse/ui";
import { PageHeader } from "@/components/pulse/page-header";
import { fieldRole } from "@/features/field/queries";
import { updateOwnName } from "@/features/account/name-actions";
import { requireUser } from "@/lib/auth";
import { splitPersonName } from "@/lib/names";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const profile = await requireUser();
  const stored = splitPersonName(profile.full_name);
  const firstName = profile.first_name || stored.firstName;
  const lastName = profile.last_name || stored.lastName;
  let engineer = false;
  try {
    engineer = (await fieldRole()) === "engineer";
  } catch {
    engineer = false;
  }

  return (
    <div className="max-w-lg space-y-8">
      <PageHeader title="Profile" />
      <form action={updateOwnName} className="space-y-4">
        <Field label="First name">
          <Input name="firstName" required defaultValue={firstName} autoComplete="given-name" />
        </Field>
        <Field label="Last name">
          <Input name="lastName" required defaultValue={lastName} autoComplete="family-name" />
        </Field>
        <Button type="submit" className="min-h-11">Save</Button>
      </form>
      {engineer ? (
        <p>
          <Link href="/field/signature" className="inline-flex min-h-11 items-center text-sm font-semibold underline decoration-red underline-offset-4">
            Signature
          </Link>
        </p>
      ) : null}
    </div>
  );
}

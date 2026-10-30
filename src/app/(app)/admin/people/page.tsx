import { InviteForm, PersonForm } from "@/components/admin-forms";
import { Card } from "@/components/ui";
import { listPeople } from "@/features/policies/queries";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "People" };

export default async function PeoplePage() {
  await requireRole(["admin"]);
  const people = await listPeople();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl">People</h1>
        <p className="mt-2 max-w-2xl text-ink/75">
          Invite a colleague by email, choose their role, or switch off access. Deactivated people cannot open Jordan Orbit.
        </p>
      </div>
      <Card>
        <h2 className="mb-4 font-display text-2xl">Invite someone</h2>
        <InviteForm />
      </Card>
      <Card>
        <h2 className="font-display text-2xl">Everyone</h2>
        <div className="mt-2">
          {people.map((person) => (
            <PersonForm key={person.id} person={person} />
          ))}
        </div>
      </Card>
    </div>
  );
}

import { InviteForm, UserForm } from "@/components/admin-forms";
import { Card } from "@/components/ui";
import { listDirectory } from "@/features/admin/queries";
import { requireRole } from "@/lib/auth";

export const instant = false;
export const metadata = { title: "Users" };

export default async function UsersPage() {
  await requireRole(["admin"]);
  const people = await listDirectory();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-4xl">Users</h1>
        <p className="mt-2 max-w-2xl text-grey">
          Invite a colleague with their Jordan Fitness email, choose a role, and switch Orbit People on or off. Deactivated people cannot open the app. Someone who signs in without an invite sees a message to ask an administrator.
        </p>
      </div>
      <Card>
        <h2 className="mb-4 font-display text-2xl">Invite someone</h2>
        <InviteForm />
      </Card>
      <Card>
        <h2 className="font-display text-2xl">Everyone</h2>
        <div className="mt-2">
          {people.length === 0 ? <p className="py-4 text-grey">No one is here yet.</p> : null}
          {people.map((person) => (
            <UserForm key={person.id} person={person} />
          ))}
        </div>
      </Card>
    </div>
  );
}

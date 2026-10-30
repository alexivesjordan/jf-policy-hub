import { PolicyForm } from "@/components/policy-form";
import { listCategories, listPeople } from "@/features/policies/queries";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "New policy" };

export default async function NewPolicyPage() {
  await requireUser();
  const [categories, people] = await Promise.all([listCategories(), listPeople()]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-4xl">Write a new policy</h1>
        <p className="mt-2 text-ink/75">Saving creates the first version. You can also upload a Word file instead.</p>
      </div>
      <PolicyForm categories={categories} people={people} />
    </div>
  );
}

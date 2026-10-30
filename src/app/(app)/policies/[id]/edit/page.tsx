import { PolicyForm } from "@/components/policy-form";
import { getPolicy, listCategories, listPeople } from "@/features/policies/queries";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Edit policy" };

export default async function EditPolicyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const [policy, categories, people] = await Promise.all([getPolicy(id), listCategories(), listPeople()]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-4xl">Edit {policy.title}</h1>
        <p className="mt-2 text-ink/75">Saving keeps the previous text in the history and adds a new version.</p>
      </div>
      <PolicyForm policy={policy} categories={categories} people={people} />
    </div>
  );
}

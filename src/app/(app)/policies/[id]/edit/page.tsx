import { PolicyForm } from "@/components/policy-form";
import { PageHeader } from "@/components/pulse/page-header";
import { getPolicy, listCategories, listPeople } from "@/features/policies/queries";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Edit policy" };

export default async function EditPolicyPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const [policy, categories, people] = await Promise.all([getPolicy(id), listCategories(), listPeople()]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader eyebrow="Pulse People" title={`Edit ${policy.title}`} description="Saving keeps the previous text in the history and adds a new version." />
      <PolicyForm policy={policy} categories={categories} people={people} />
    </div>
  );
}

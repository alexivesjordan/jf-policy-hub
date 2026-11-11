import { PolicyForm } from "@/components/policy-form";
import { PageHeader } from "@/components/pulse/page-header";
import { listCategories, listPeople } from "@/features/policies/queries";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "New policy" };

export default async function NewPolicyPage() {
  await requireUser();
  const [categories, people] = await Promise.all([listCategories(), listPeople()]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader eyebrow="Pulse People" title="Write a new policy" />
      <PolicyForm categories={categories} people={people} />
    </div>
  );
}

import { AutoApplyForm, CategoryForm } from "@/components/admin-forms";
import { Card } from "@/components/pulse/ui";
import { PageHeader } from "@/components/pulse/page-header";
import { listCategories } from "@/features/policies/queries";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  await requireRole(["admin"]);
  const categories = await listCategories();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Pulse People"
        title="Categories"
        description="Automatic updates are off unless you turn them on. When they are on, only low-severity suggestions are applied without a person approving them. Approvers still get a notification."
      />
      <Card>
        <CategoryForm />
      </Card>
      <div className="space-y-3">
        {categories.map((category) => (
          <AutoApplyForm key={category.id} category={category} />
        ))}
      </div>
    </div>
  );
}

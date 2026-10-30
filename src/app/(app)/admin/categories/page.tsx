import { AutoApplyForm, CategoryForm } from "@/components/admin-forms";
import { Card } from "@/components/ui";
import { listCategories } from "@/features/policies/queries";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Categories" };

export default async function CategoriesPage() {
  await requireRole(["admin"]);
  const categories = await listCategories();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-4xl">Categories</h1>
        <p className="mt-2 text-ink/75">
          Automatic updates are off unless you turn them on. When they are on, only low-severity suggestions are applied without a person approving them. Approvers still get a notification.
        </p>
      </div>
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

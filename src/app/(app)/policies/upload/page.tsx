import { UploadForm } from "@/components/upload-form";
import { listCategories, listPolicies } from "@/features/policies/queries";
import { requireUser } from "@/lib/auth";
import { needsDocument } from "@/lib/format";
import { oneParam } from "@/lib/utils";

export const instant = false;
export const metadata = { title: "Upload a policy" };

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const params = await searchParams;
  const requested = oneParam(params.policy);
  const [policies, categories] = await Promise.all([listPolicies({}), listCategories()]);
  const options = policies
    .map((policy) => ({
      id: policy.id,
      title: policy.title,
      categoryName: policy.category?.name ?? "Other",
      needsDocument: needsDocument(policy),
      hasContent: policy.current_content.trim().length > 0,
    }))
    .sort((a, b) => Number(b.needsDocument) - Number(a.needsDocument) || a.title.localeCompare(b.title));

  const initialPolicyId = options.some((policy) => policy.id === requested) ? requested : "";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-4xl">Upload a policy document</h1>
        <p className="mt-2 text-ink/75">
          Choose the policy this file belongs to. A Word document fills in the editable text and saves a new version. A PDF is stored alongside the policy and also saves a version.
        </p>
      </div>
      <div className="rounded-3xl border border-line bg-card p-5">
        <UploadForm policies={options} categories={categories} initialPolicyId={initialPolicyId} />
      </div>
    </div>
  );
}

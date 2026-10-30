import { connection } from "next/server";
import { UploadForm } from "@/components/upload-form";
import { findPolicy, listCategories, listPolicies } from "@/features/policies/queries";
import { requireUser } from "@/lib/auth";
import { needsDocument } from "@/lib/format";
import type { PolicyRecord } from "@/lib/types";
import { oneParam } from "@/lib/utils";

export const instant = false;
export const metadata = { title: "Upload a policy" };

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  await requireUser();
  const params = await searchParams;
  const requested = oneParam(params.policy);
  const [listed, categories] = await Promise.all([listPolicies({}), listCategories()]);
  let policies = listed.filter((policy) => policy.status !== "archived");

  if (requested && !policies.some((policy) => policy.id === requested)) {
    const extra = await findPolicy(requested);
    if (extra && extra.status !== "archived") policies = [extra, ...policies];
  }

  const options = policies
    .map((policy) => toOption(policy))
    .sort((a, b) => {
      if (a.id === requested) return -1;
      if (b.id === requested) return 1;
      return a.title.localeCompare(b.title);
    });

  const initialPolicyId = options.some((policy) => policy.id === requested) ? requested : "";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-grey">Orbit People</p>
        <h1 className="font-display mt-2 text-4xl">Upload a policy document</h1>
        <p className="mt-2 text-grey">
          Choose any draft or active policy, including one that already has a file. Word and PDF files are read into the policy text, and the original file stays attached. Saving creates a new version.
        </p>
      </div>
      <div className="rounded-3xl border border-line bg-card p-5">
        <UploadForm policies={options} categories={categories} initialPolicyId={initialPolicyId} />
      </div>
    </div>
  );
}

function toOption(policy: PolicyRecord) {
  return {
    id: policy.id,
    title: policy.title,
    categoryName: policy.category?.name ?? "Other",
    status: policy.status,
    needsDocument: needsDocument(policy),
    hasFile: Boolean(policy.source_file_path),
    hasContent: policy.current_content.trim().length > 0,
  };
}

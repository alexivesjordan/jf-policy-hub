import { SuggestForm } from "@/components/suggest-form";
import { PageHeader } from "@/components/pulse/page-header";
import { getPolicy } from "@/features/policies/queries";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Suggest a change" };

export default async function SuggestPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const policy = await getPolicy(id);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        eyebrow="Pulse People"
        title="Suggest a change"
        description={`${policy.title}. Approvers will see your text next to the current policy. If this category allows automatic updates, a low-severity suggestion is applied straight away.`}
      />
      <SuggestForm policyId={policy.id} content={policy.current_content} />
    </div>
  );
}

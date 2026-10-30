import { SuggestForm } from "@/components/suggest-form";
import { getPolicy } from "@/features/policies/queries";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Suggest a change" };

export default async function SuggestPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const policy = await getPolicy(id);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-display text-4xl">Suggest a change</h1>
        <p className="mt-2 text-ink/75">
          {policy.title}. Approvers will see your text next to the current policy. If this category allows automatic updates, a low-severity suggestion is applied straight away.
        </p>
      </div>
      <SuggestForm policyId={policy.id} content={policy.current_content} />
    </div>
  );
}

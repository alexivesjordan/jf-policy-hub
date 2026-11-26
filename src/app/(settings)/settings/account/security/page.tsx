import { Suspense } from "react";
import { SetPasswordForm } from "@/components/password-forms";
import { PageHeader } from "@/components/pulse/page-header";
import { TwoStepForm } from "@/components/two-step-form";
import { requireUser } from "@/lib/auth";
import { oneParam } from "@/lib/utils";

export const metadata = { title: "Security" };

export default function AccountSecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={null}>
      <SecurityBody searchParams={searchParams} />
    </Suspense>
  );
}

async function SecurityBody({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const params = await searchParams;
  const setup = oneParam(params.setup) === "1";
  const saved = oneParam(params.saved) === "1";
  return (
    <div className="max-w-lg space-y-10">
      <PageHeader title="Security" />
      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Password</h2>
        {saved ? <p className="text-sm text-ink">Password saved.</p> : null}
        <SetPasswordForm next={setup ? "/" : "/settings/account/security?saved=1"} setup={setup} />
      </section>
      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Two-step sign-in</h2>
        <TwoStepForm />
      </section>
    </div>
  );
}

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { oneParam } from "@/lib/utils";

export default function PasswordRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={null}>
      <PasswordTarget searchParams={searchParams} />
    </Suspense>
  );
}

async function PasswordTarget({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const setup = oneParam(params.setup) === "1";
  redirect(setup ? "/settings/account/security?setup=1" : "/settings/account/security");
}

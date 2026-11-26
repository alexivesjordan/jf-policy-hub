import { redirect } from "next/navigation";
import { oneParam } from "@/lib/utils";

export const instant = false;

export default async function PasswordRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const setup = oneParam(params.setup) === "1";
  redirect(setup ? "/settings/account/security?setup=1" : "/settings/account/security");
}

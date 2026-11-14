import { redirect } from "next/navigation";
import { connection } from "next/server";

export const instant = false;

export default async function DashboardPage() {
  await connection();
  redirect("/people");
}

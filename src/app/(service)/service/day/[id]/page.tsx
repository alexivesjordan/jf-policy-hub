import { connection } from "next/server";
import { redirect } from "next/navigation";
import { engineerJobPath } from "@/lib/service/visit-route";

export const instant = false;
export const metadata = { title: "Stop" };

export default async function MyServiceStopPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  redirect(engineerJobPath(id));
}

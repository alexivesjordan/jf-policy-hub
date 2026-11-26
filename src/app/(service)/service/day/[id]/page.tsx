import Link from "next/link";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";
import { MyDayStop } from "@/components/service/my-day";
import { loadMyServiceDay, loadServiceVisit } from "@/features/service/queries";
import { canUseService } from "@/lib/access";
import { getCurrentProfile } from "@/lib/auth";

export const metadata = { title: "Stop" };

export default async function MyServiceStopPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/service/day");
  if (!profile.access_granted) redirect("/no-access");
  if (!profile.is_active) redirect("/account-inactive");
  const { id } = await params;
  const mine = await loadMyServiceDay();
  const own = mine.stops.find((stop) => stop.id === id) ?? null;
  if (own) {
    return (
      <div className="space-y-4">
        <Link href="/service/day" className="inline-flex min-h-11 items-center text-sm font-semibold underline">My day</Link>
        <MyDayStop stop={own} />
      </div>
    );
  }
  if (!canUseService(profile)) notFound();
  const loaded = await loadServiceVisit(id);
  if (!loaded.visit) notFound();
  return (
    <div className="space-y-4">
      <Link href="/service/day" className="inline-flex min-h-11 items-center text-sm font-semibold underline">My day</Link>
      <MyDayStop stop={loaded.visit} />
    </div>
  );
}

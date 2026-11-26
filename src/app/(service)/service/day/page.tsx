import { connection } from "next/server";
import { redirect } from "next/navigation";
import { MyDayList } from "@/components/service/my-day";
import { loadMyServiceDay } from "@/features/service/queries";
import { getCurrentProfile } from "@/lib/auth";
import { formatDate } from "@/lib/format";

export const metadata = { title: "My day" };

export default async function MyServiceDayPage() {
  await connection();
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login?next=/service/day");
  if (!profile.access_granted) redirect("/no-access");
  if (!profile.is_active) redirect("/account-inactive");
  const day = await loadMyServiceDay();
  if (day.error) return <p>{day.error}</p>;
  return <MyDayList dayLabel={day.day ? formatDate(day.day) : "My day"} stops={day.stops} />;
}

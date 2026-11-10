import { BookFixtureForm, UnavailabilityForm } from "@/components/calendar-forms";
import { Card } from "@/components/ui";
import { getOfficeContext, listJobs } from "@/features/operations/queries";
import { requireOperationsUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Resource Availability" };

export default async function CalendarPage() {
  await requireOperationsUser();
  const context = await getOfficeContext();
  const canEdit = context.is_owner || context.ops_role === "install_lead" || context.ops_role === "admin_owner";
  const start = monday(new Date());
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  const supabase = await createClient();
  const calendar = await supabase.rpc("orbit_calendar", {
    p_start: iso(days[0]),
    p_end: iso(days[6]),
  });
  const data = (calendar.data ?? { resources: [], reservations: [], unavailability: [] }) as {
    resources: { id: string; name: string; resource_type: string; notes: string | null }[];
    reservations: { resource_id: string; day: string; kind: string; cin7_number: string | null }[];
    unavailability: { resource_id: string; starts_on: string; ends_on: string; reason: string }[];
  };
  const jobs = (await listJobs()).filter((job) => job.fixture);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-4xl">Resource Availability</h1>
        <p className="mt-2 max-w-2xl text-ink/70">
          Crews, vans, and the stair climber for this week. Unavailability and fixture booking are manual. Lynnstar is not connected.
        </p>
      </div>
      {calendar.error ? <p className="text-sm text-ink">{calendar.error.message}</p> : null}
      <div className="overflow-x-auto rounded-3xl border border-line">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <thead>
            <tr className="text-left text-grey">
              <th className="px-3 py-2">Resource</th>
              {days.map((day) => (
                <th key={iso(day)} className="px-3 py-2 font-medium">{day.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.resources.map((resource) => (
              <tr key={resource.id} className="border-t border-line">
                <td className="px-3 py-3">
                  <p className="font-semibold text-ink">{resource.name}</p>
                  <p className="text-xs text-grey">{resource.resource_type}</p>
                </td>
                {days.map((day) => {
                  const key = iso(day);
                  const held = data.reservations.filter((item) => item.resource_id === resource.id && item.day.startsWith(key));
                  const off = data.unavailability.some((item) => item.resource_id === resource.id && key >= item.starts_on && key <= item.ends_on);
                  const weekendCrew = resource.resource_type === "installer" && [0, 6].includes(new Date(`${key}T12:00:00Z`).getUTCDay());
                  return (
                    <td key={key} className="px-3 py-3 align-top text-grey">
                      {off || weekendCrew ? "Unavailable" : held.map((item) => `${item.kind} ${item.cin7_number ?? ""}`).join(", ") || "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="font-display text-2xl">Unavailability</h2>
            <div className="mt-4"><UnavailabilityForm resources={data.resources} /></div>
          </Card>
          <Card>
            <h2 className="font-display text-2xl">Book a fixture job</h2>
            <div className="mt-4">
              <BookFixtureForm
                resources={data.resources}
                jobs={jobs.map((job) => ({ id: job.id, label: `${job.cin7_number} — ${job.customer_name}` }))}
              />
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function monday(date: Date) {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() - day + 1);
  return copy;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

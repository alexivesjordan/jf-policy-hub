import Link from "next/link";
import { Card } from "@/components/pulse/ui";
import { PageHeader } from "@/components/pulse/page-header";
import { ErrorState } from "@/components/pulse/states";
import { getOfficeContext, listJobs, listPulseNotifications, listPulseTasks } from "@/features/operations/queries";
import { greetingName } from "@/lib/format";
import { requireOperationsUser } from "@/lib/auth";

export const metadata = { title: "Install office" };

export default async function OperationsHomePage() {
  const profile = await requireOperationsUser();
  let contextError: string | null = null;
  let role = "not set";
  let owner = false;
  let jobs = 0;
  let fixtures = 0;
  let tasks = 0;
  let unread = 0;

  try {
    const [context, jobRows, taskRows, notes] = await Promise.all([
      getOfficeContext(),
      listJobs(),
      listPulseTasks(),
      listPulseNotifications(true),
    ]);
    role = context.ops_role ?? "not set";
    owner = context.is_owner;
    jobs = jobRows.length;
    fixtures = jobRows.filter((job) => job.fixture).length;
    tasks = taskRows.filter((task) => task.status === "open").length;
    unread = notes.length;
  } catch (error) {
    contextError = error instanceof Error ? error.message : "Could not load the office.";
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Pulse Operations"
        title={`Hello ${greetingName(profile)}`}
        description="Jobs, pricing, exceptions, and notifications."
      />

      {contextError ? (
        <ErrorState title="The office did not load" description={contextError} />
      ) : (
        <p className="text-sm text-grey">
          Operations role: <span className="text-ink">{roleLabel(role)}</span>
          {owner ? " · named owner" : ""}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Stat href="/operations/jobs" label="Jobs you can see" value={String(jobs)} hint={`${fixtures} fixture`} />
        <Stat href="/operations/tasks" label="Open tasks" value={String(tasks)} hint="Exceptions list" />
        <Stat href="/operations/notifications" label="Unread" value={String(unread)} hint="Operations inbox" />
      </div>

      <Card>
        <h2 className="font-display text-2xl">Fixture data</h2>
        <p className="mt-3 leading-7 text-ink/75">
          Jobs numbered FIXTURE- are demo rows so this office can be opened before Cin7. They are not production installs.
          Segment and customer type on those rows are labels for the screen, not a Cin7 mapping. Quote versions stay empty until a pricer exists.
        </p>
      </Card>
    </div>
  );
}

function roleLabel(role: string) {
  if (role === "admin_owner") return "Owner admin";
  if (role === "install_lead") return "Install lead";
  if (role === "installer") return "Installer";
  if (role === "hq") return "HQ";
  if (role === "sales") return "Sales";
  if (role === "not set") return "Not set";
  return role;
}

function Stat({ href, label, value, hint }: { href: string; label: string; value: string; hint: string }) {
  return (
    <Link href={href} className="rounded-3xl border border-line bg-card p-5 hover:border-red">
      <p className="text-sm text-grey">{label}</p>
      <p className="font-display mt-2 text-4xl">{value}</p>
      <p className="mt-2 text-sm text-grey">{hint}</p>
    </Link>
  );
}

import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { PersonChecklist } from "@/components/hr/person-checklist";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState, PageSkeleton } from "@/components/pulse/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loadPerson } from "@/features/hr/queries";
import { londonToday } from "@/lib/hr/checklists";
import { requireUser } from "@/lib/auth";
import { oneParam } from "@/lib/utils";

export const metadata = { title: "Team" };

export default function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Person params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Person({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  await connection();
  await requireUser();
  const { id } = await params;
  const tab = oneParam((await searchParams).tab);
  const person = await loadPerson(id);
  if (!person) notFound();
  if ("blocked" in person) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Jordan Pulse" title="Team" />
        <p className="text-sm font-semibold">Turn on two-step sign-in to open this.</p>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Jordan Pulse" title={person.name} />
      <Tabs defaultValue={tab === "checklist" ? "checklist" : "details"}>
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="checklist">Checklist</TabsTrigger>
          <TabsTrigger value="employment">Employment</TabsTrigger>
          <TabsTrigger value="pay">Pay</TabsTrigger>
          <TabsTrigger value="rtw">Right to work</TabsTrigger>
          <TabsTrigger value="sickness">Sickness</TabsTrigger>
          <TabsTrigger value="changes">Changes</TabsTrigger>
        </TabsList>
        <TabsContent value="checklist">
          <PersonChecklist
            employeeId={person.id}
            name={person.name}
            status={person.status}
            start={person.start}
            today={londonToday()}
            profileId={person.profileId}
            engineerResourceId={person.engineerResourceId}
            canEdit={person.checklistAccess === "edit"}
            mfa={person.checklistAccess === "mfa"}
            checklists={person.checklists}
          />
        </TabsContent>
        <TabsContent value="details" className="rounded-3xl border border-line bg-card p-5 text-sm">
          <p className="font-semibold">{person.role}</p>
          <p className="text-grey">{person.email}</p>
          <p>{person.phone}</p>
        </TabsContent>
        <TabsContent value="employment" className="rounded-3xl border border-line bg-card p-5 text-sm">
          <p>{person.department} · {person.location}</p>
          <p>Started {person.start}</p>
          <p>{person.contract} · {person.hours} hours · {person.notice}</p>
        </TabsContent>
        <TabsContent value="pay" className="space-y-2">
          {person.pay.length === 0 ? <EmptyState title="No pay history" /> : person.pay.map((row) => (
            <p key={row.id} className="rounded-2xl border border-line bg-card px-4 py-3 text-sm">{row.basis} from {row.from}</p>
          ))}
        </TabsContent>
        <TabsContent value="rtw" className="space-y-2">
          {person.rtw.length === 0 ? <EmptyState title="No documents yet. Upload one." /> : person.rtw.map((row) => (
            <p key={row.id} className="rounded-2xl border border-line bg-card px-4 py-3 text-sm">{row.type} · checked {row.checked} · expires {row.expires}</p>
          ))}
        </TabsContent>
        <TabsContent value="sickness" className="space-y-2">
          {person.review ? <p className="text-sm font-semibold">Absence review</p> : null}
          {person.sickness.length === 0 ? <EmptyState title="No sickness recorded" /> : person.sickness.map((row) => (
            <p key={row.id} className="rounded-2xl border border-line bg-card px-4 py-3 text-sm">{row.from} – {row.to} · {row.status}</p>
          ))}
        </TabsContent>
        <TabsContent value="changes">
          {person.changes.length === 0 ? <EmptyState title="No requests waiting" /> : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

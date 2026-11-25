import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState, PageSkeleton } from "@/components/pulse/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loadPerson } from "@/features/hr/queries";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Team" };

export default function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Person params={params} />
    </Suspense>
  );
}

async function Person({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  await requireUser();
  const { id } = await params;
  const person = await loadPerson(id);
  if (!person) notFound();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Jordan Pulse" title={person.name} />
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="employment">Employment</TabsTrigger>
          <TabsTrigger value="pay">Pay</TabsTrigger>
          <TabsTrigger value="rtw">Right to work</TabsTrigger>
          <TabsTrigger value="sickness">Sickness</TabsTrigger>
          <TabsTrigger value="changes">Changes</TabsTrigger>
        </TabsList>
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

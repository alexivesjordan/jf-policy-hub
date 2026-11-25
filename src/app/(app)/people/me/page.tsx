import { Suspense } from "react";
import { connection } from "next/server";
import { PageHeader } from "@/components/pulse/page-header";
import { EmptyState, PageSkeleton } from "@/components/pulse/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loadMyRecord } from "@/features/hr/queries";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "My record" };

export default function MyRecordPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Record />
    </Suspense>
  );
}

async function Record() {
  await connection();
  await requireUser();
  const me = await loadMyRecord();
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Jordan Pulse" title={me.preferredName} />
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="employment">Employment</TabsTrigger>
          <TabsTrigger value="pay">Pay</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="leave">Time off</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="rounded-3xl border border-line bg-card p-5">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Item label="Name" value={me.fullName} />
            <Item label="Work email" value={me.workEmail} />
            <Item label="Phone" value={me.phone} />
            <Item label="Personal email" value={me.personalEmail} />
            <Item label="Address" value={me.address} />
          </dl>
          <ul className="mt-4 space-y-2">
            {me.changes.map((change) => (
              <li key={change.id} className="flex min-h-11 items-center justify-between rounded-2xl border border-line px-3">
                <span>{change.field}</span>
                <span className="text-sm font-semibold">{change.status}</span>
              </li>
            ))}
          </ul>
        </TabsContent>
        <TabsContent value="employment" className="rounded-3xl border border-line bg-card p-5">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Item label="Role" value={me.jobTitle} />
            <Item label="Department" value={me.department} />
            <Item label="Location" value={me.location} />
            <Item label="Started" value={me.startDate} />
            <Item label="Contract" value={me.contract} />
            <Item label="Hours" value={me.hours} />
            <Item label="Notice" value={me.notice} />
          </dl>
        </TabsContent>
        <TabsContent value="pay" className="rounded-3xl border border-line bg-card p-5">
          <p className="text-sm font-semibold">{me.pay}</p>
        </TabsContent>
        <TabsContent value="documents" className="rounded-3xl border border-line bg-card p-5">
          {me.documents.length === 0 ? <EmptyState title="No documents yet. Upload one." /> : null}
        </TabsContent>
        <TabsContent value="leave" className="space-y-2">
          {me.leave.length === 0 ? <EmptyState title="No requests waiting" /> : me.leave.map((item) => (
            <p key={item.id} className="flex min-h-11 items-center justify-between rounded-2xl border border-line bg-card px-4">
              <span>{item.label}</span>
              <span className="text-sm">{item.status}</span>
            </p>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-grey">{label}</dt>
      <dd className="font-semibold">{value || "—"}</dd>
    </div>
  );
}

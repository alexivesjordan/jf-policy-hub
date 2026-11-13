import { connection } from "next/server";
import { DocumentsForm } from "@/components/field/documents-form";
import { PageHeader } from "@/components/pulse/page-header";
import { canManageVisitDocuments, engineerLinks, fieldRole, listVisitDocuments } from "@/features/field/queries";
import type { VisitDocumentKey } from "@/lib/installs/product-lines";

export const instant = false;
export const metadata = { title: "Visit documents" };

export default async function VisitDocumentsPage() {
  await connection();
  let allowed = false;
  let readable = false;
  let uploaded: VisitDocumentKey[] = [];
  let links: { name: string; linked: boolean; profileName: string | null }[] = [];
  let problem: string | null = null;
  try {
    const role = await fieldRole();
    readable = role === "admin" || role === "ops" || role === "engineer";
    allowed = await canManageVisitDocuments();
    if (readable) {
      const documents = await listVisitDocuments();
      uploaded = documents.map((document) => document.key);
    }
    if (allowed) links = await engineerLinks();
  } catch (error) {
    problem = error instanceof Error ? error.message : "Could not load the documents.";
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Pulse Operations" title="Visit documents" description="Catalogue and maintenance guides emailed with a job sheet." />
      {problem ? <p className="text-sm font-semibold text-red">{problem}</p> : null}
      {readable ? <DocumentsForm uploaded={uploaded} canUpload={allowed} /> : <p className="text-base">The office uploads these files.</p>}
      {allowed ? (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">Engineer logins</h2>
          <p className="text-sm text-grey">An admin links each engineer from People, on the user card.</p>
          <ul className="space-y-2">
            {links.map((person) => (
              <li key={person.name} className="rounded-2xl border border-line bg-card px-4 py-3 text-sm">
                <span className="font-semibold">{person.name.replace(/^FIXTURE — /, "")}</span>
                <span className="mt-1 block text-grey">{person.linked ? `Linked${person.profileName ? ` to ${person.profileName}` : ""}` : "Not linked yet."}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const instant = false;
export const metadata = { title: "Shared" };

export default async function GuestHomePage() {
  const profile = await requireUser();
  const supabase = await createClient();
  const { data: blocked } = await supabase.rpc("guest_blocked");
  if (blocked) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16">
        <h1 className="font-display text-3xl">This invite has ended</h1>
      </main>
    );
  }
  const { data } = await supabase.from("hr_cases").select("id, title");
  const cases = (Array.isArray(data) ? data : []) as { id: string; title: string }[];
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <p className="text-sm text-grey">{profile.email}</p>
      <h1 className="font-display mt-2 text-3xl">Shared</h1>
      {cases.length === 0 ? <p className="mt-6 text-sm text-grey">Nothing shared</p> : null}
      <ul className="mt-6 space-y-2">
        {cases.map((item) => (
          <li key={item.id} className="rounded-2xl border border-line bg-card px-4 py-3 font-semibold">{item.title}</li>
        ))}
      </ul>
    </main>
  );
}

import { PageHeader } from "@/components/pulse/page-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Appearance" };

export default async function AppearancePage() {
  await requireUser();
  return (
    <div className="max-w-lg space-y-6">
      <PageHeader title="Appearance" />
      <div className="flex min-h-11 items-center justify-between gap-4">
        <span className="text-sm font-semibold">Theme</span>
        <ThemeToggle />
      </div>
    </div>
  );
}

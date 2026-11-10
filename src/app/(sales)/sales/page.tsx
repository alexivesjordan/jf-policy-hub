import Link from "next/link";
import { requireSalesUser } from "@/lib/auth";

export const metadata = { title: "Sales" };

export default async function SalesHomePage() {
  await requireSalesUser();
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-grey">Pulse Sales</p>
        <h1 className="font-display mt-2 text-4xl">Install quoting</h1>
        <p className="mt-2 max-w-2xl text-ink/70">
          Price an install from a Cin7 order number or a quote PDF. The effort table and pricing settings stay with the install team.
        </p>
      </div>
      <Link href="/sales/quote" className="inline-flex min-h-11 items-center rounded-full bg-red px-4 text-sm font-semibold text-white">
        Price a quote
      </Link>
    </div>
  );
}

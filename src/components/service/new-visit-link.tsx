"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/pulse/ui";
import { newVisitHref } from "@/lib/service/form-key";

export function NewVisitLink({ day, personId }: { day: string; personId?: string }) {
  const router = useRouter();
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => router.push(newVisitHref(day, crypto.randomUUID(), personId))}
    >
      New visit
    </Button>
  );
}

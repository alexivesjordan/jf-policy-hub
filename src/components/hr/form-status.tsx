"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { Banner } from "@/components/pulse/ui";
import type { ActionState } from "@/lib/action-state";

export function FormStatus({ state }: { state: ActionState }) {
  useEffect(() => {
    if (state?.ok) toast.success(state.message);
  }, [state]);
  if (!state || state.ok) return null;
  return <Banner tone="error">{state.message}</Banner>;
}

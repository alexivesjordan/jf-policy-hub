"use client";

import { useEffect } from "react";
import { Button } from "@/components/pulse/ui";
import { ErrorState } from "@/components/pulse/states";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      title="This page did not load"
      description={error.message || "Jordan Pulse hit a problem loading this screen."}
      action={
        <Button type="button" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function QuoteNotice({ children }: { children: ReactNode }) {
  return (
    <Alert>
      <Info className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
      <AlertDescription className="text-foreground">{children}</AlertDescription>
    </Alert>
  );
}

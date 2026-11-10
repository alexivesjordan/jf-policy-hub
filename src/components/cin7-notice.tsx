import { cin7IsConnected } from "@/lib/cin7/client";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function Cin7Notice() {
  if (cin7IsConnected()) return null;
  return (
    <Alert className="mb-6">
      <AlertDescription className="col-start-2 text-foreground">Live orders are not connected yet.</AlertDescription>
    </Alert>
  );
}

export type InstallStage = "quoting" | "booked" | "awaiting_access" | "ready" | "completed";

/** quoting is reserved for subcontractor quotes. accessComplete means the form was submitted. Media is optional. */
export function installStage(input: {
  status: string;
  accessSent: boolean;
  accessComplete: boolean;
  quoting?: boolean;
}): InstallStage {
  if (input.quoting) return "quoting";
  if (input.status === "completed") return "completed";
  if (input.accessComplete) return "ready";
  if (input.accessSent) return "awaiting_access";
  return "booked";
}

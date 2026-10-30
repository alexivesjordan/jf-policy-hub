import { Box, Cog, FileText, Headset, TrendingUp, Users } from "lucide-react";
import type { ModuleIcon } from "@/modules/registry";

const icons = {
  people: Users,
  service: Headset,
  supply: Box,
  operations: Cog,
  sales: TrendingUp,
  finance: FileText,
} as const;

export function ModuleGlyph({ name, className }: { name: ModuleIcon; className?: string }) {
  const Icon = icons[name];
  return <Icon className={className} aria-hidden="true" strokeWidth={1.75} />;
}

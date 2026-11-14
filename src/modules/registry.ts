export type ModuleIcon = "people" | "service" | "supply" | "operations" | "sales" | "finance";

export type ModuleStatus = "active" | "coming-soon";

export type ModuleNavItem = {
  href: string;
  label: string;
  count?: "pending" | "unread";
  adminOnly?: boolean;
  ownerOnly?: boolean;
  disabled?: boolean;
};

export type PulseModule = {
  id: string;
  name: string;
  tagline: string;
  href: string;
  status: ModuleStatus;
  icon: ModuleIcon;
  /** Path prefixes that belong to this module. Used to pick the sidebar. */
  paths: string[];
  nav: ModuleNavItem[];
};

/**
 * Add a module here, then add its routes. Active modules need a real `href`.
 * Coming-soon modules open `/modules/[id]` until their routes exist.
 */
export const pulseModules: PulseModule[] = [
  {
    id: "people",
    name: "Pulse People",
    tagline: "HR & compliance",
    href: "/dashboard",
    status: "active",
    icon: "people",
    paths: ["/dashboard", "/policies", "/amendments", "/notifications", "/admin"],
    nav: [
      { href: "/dashboard", label: "Overview" },
      { href: "/policies", label: "Policies" },
      { href: "/amendments", label: "Review queue", count: "pending" },
      { href: "/admin/categories", label: "Categories", adminOnly: true },
    ],
  },
  {
    id: "service",
    name: "Pulse Service",
    tagline: "Aftersales & support",
    href: "/modules/service",
    status: "coming-soon",
    icon: "service",
    paths: ["/modules/service"],
    nav: [],
  },
  {
    id: "supply",
    name: "Pulse Supply",
    tagline: "Procurement",
    href: "/modules/supply",
    status: "coming-soon",
    icon: "supply",
    paths: ["/modules/supply"],
    nav: [],
  },
  {
    id: "operations",
    name: "Pulse Operations",
    tagline: "Install office",
    href: "/operations",
    status: "active",
    icon: "operations",
    paths: ["/operations"],
    nav: [
      { href: "/operations", label: "Overview" },
      { href: "/field", label: "My jobs" },
      { href: "/operations/installs", label: "Installs" },
      { href: "/operations/jobs", label: "Jobs" },
      { href: "/operations/calendar", label: "Resource Availability" },
      { href: "/operations/documents", label: "Visit documents" },
      { href: "/operations/tasks", label: "Tasks" },
      { href: "/operations/overrides", label: "Gate overrides", ownerOnly: true },
      { href: "/operations/settings", label: "Effort table", ownerOnly: true },
    ],
  },
  {
    id: "sales",
    name: "Pulse Sales",
    tagline: "Quoting",
    href: "/sales",
    status: "active",
    icon: "sales",
    paths: ["/sales"],
    nav: [
      { href: "/sales", label: "Overview" },
      { href: "/sales/quote", label: "Install quoting" },
      { href: "/sales/installs", label: "Installs" },
      { href: "/sales/service", label: "Warranties and Servicing" },
    ],
  },
  {
    id: "finance",
    name: "Pulse Finance",
    tagline: "Financial workflows",
    href: "/modules/finance",
    status: "coming-soon",
    icon: "finance",
    paths: ["/modules/finance"],
    nav: [],
  },
];

export function getModule(id: string) {
  return pulseModules.find((module) => module.id === id);
}

export function moduleFromPath(pathname: string) {
  return pulseModules.find((module) =>
    module.paths.some((path) => pathname === path || pathname.startsWith(`${path}/`)),
  );
}

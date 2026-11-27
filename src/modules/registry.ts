export type ModuleIcon = "people" | "service" | "supply" | "operations" | "sales" | "finance" | "logistics";

export type ModuleStatus = "active" | "coming-soon";

export type ModuleNavItem = {
  href: string;
  label: string;
  count?: "pending" | "unread";
  adminOnly?: boolean;
  ownerOnly?: boolean;
  /** Workspace owner or admin. Used for HR settings. */
  workspaceAdminOnly?: boolean;
  disabled?: boolean;
  /** Match this href only, so a shorter path is not active on a longer sibling. */
  exact?: boolean;
  /** Collapsible group. The parent is a toggle; the children are the links. */
  children?: ModuleNavItem[];
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
    href: "/people",
    status: "active",
    icon: "people",
    paths: ["/people", "/dashboard", "/policies", "/amendments", "/notifications", "/admin", "/account"],
    nav: [
      { href: "/people", label: "Overview" },
      { href: "/people/team", label: "Team" },
      { href: "/people/time-off", label: "Time off" },
      { href: "/people/cases", label: "Cases" },
      { href: "/people/calendar", label: "Calendar" },
      { href: "/policies", label: "Policies" },
      { href: "/people/settings", label: "HR settings", workspaceAdminOnly: true },
    ],
  },
  {
    id: "service",
    name: "Pulse Service",
    tagline: "Service visits",
    href: "/service",
    status: "active",
    icon: "service",
    paths: ["/service"],
    nav: [
      { href: "/service", label: "Board", exact: true },
      { href: "/service/day", label: "My day" },
    ],
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
    paths: ["/operations", "/field"],
    nav: [
      { href: "/operations", label: "Overview" },
      { href: "/operations/schedule", label: "Schedule" },
      { href: "/operations/installs", label: "Installs" },
      { href: "/operations/fleet", label: "Fleet" },
      { href: "/operations/tasks", label: "Tasks" },
      {
        href: "/operations/subcontractors",
        label: "Setup",
        children: [
          { href: "/operations/subcontractors", label: "Subcontractors" },
          { href: "/operations/settings", label: "Effort tables", ownerOnly: true },
          { href: "/operations/overrides", label: "Gate overrides", ownerOnly: true },
          { href: "/operations/documents", label: "Visit documents" },
        ],
      },
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
      { href: "/sales/installs", label: "Installs" },
      { href: "/sales/radar", label: "Radar" },
      {
        href: "/sales/quote",
        label: "Quotes",
        children: [
          { href: "/sales/quote", label: "Install quoting" },
          { href: "/sales/service", label: "Warranties & servicing" },
        ],
      },
    ],
  },
  {
    id: "logistics",
    name: "Pulse Logistics",
    tagline: "Commercial invoices",
    href: "/logistics/commercial-invoices",
    status: "active",
    icon: "logistics",
    paths: ["/logistics"],
    nav: [
      {
        href: "/logistics/commercial-invoices",
        label: "Commercial Invoices",
        children: [
          { href: "/logistics/commercial-invoices", label: "Generate a Commercial Invoice", exact: true },
          { href: "/logistics/commercial-invoices/search", label: "Search Commercial Invoices" },
        ],
      },
      { href: "/logistics/pack-estimate", label: "Pack estimate" },
      { href: "/logistics/load-plan", label: "Load plan" },
      { href: "/logistics/packaging", label: "Packaging" },
      { href: "/logistics/customs-statements", label: "Customs statements" },
      { href: "/logistics/landed-cost", label: "Landed cost" },
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

export type ModuleIcon = "people" | "service" | "supply" | "operations" | "sales" | "finance";

export type ModuleStatus = "active" | "coming-soon";

export type ModuleNavItem = {
  href: string;
  label: string;
  count?: "pending" | "unread";
  adminOnly?: boolean;
};

export type OrbitModule = {
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
export const orbitModules: OrbitModule[] = [
  {
    id: "people",
    name: "Orbit People",
    tagline: "HR & compliance",
    href: "/dashboard",
    status: "active",
    icon: "people",
    paths: ["/dashboard", "/policies", "/amendments", "/notifications", "/admin"],
    nav: [
      { href: "/dashboard", label: "Overview" },
      { href: "/policies", label: "Policies" },
      { href: "/amendments", label: "Review queue", count: "pending" },
      { href: "/notifications", label: "Notifications", count: "unread" },
      { href: "/admin/people", label: "People", adminOnly: true },
      { href: "/admin/categories", label: "Categories", adminOnly: true },
    ],
  },
  {
    id: "service",
    name: "Orbit Service",
    tagline: "Aftersales & support",
    href: "/modules/service",
    status: "coming-soon",
    icon: "service",
    paths: ["/modules/service"],
    nav: [],
  },
  {
    id: "supply",
    name: "Orbit Supply",
    tagline: "Procurement",
    href: "/modules/supply",
    status: "coming-soon",
    icon: "supply",
    paths: ["/modules/supply"],
    nav: [],
  },
  {
    id: "operations",
    name: "Orbit Operations",
    tagline: "Fabrications & logistics",
    href: "/modules/operations",
    status: "coming-soon",
    icon: "operations",
    paths: ["/modules/operations"],
    nav: [],
  },
  {
    id: "sales",
    name: "Orbit Sales",
    tagline: "CRM & commercial",
    href: "/modules/sales",
    status: "coming-soon",
    icon: "sales",
    paths: ["/modules/sales"],
    nav: [],
  },
  {
    id: "finance",
    name: "Orbit Finance",
    tagline: "Financial workflows",
    href: "/modules/finance",
    status: "coming-soon",
    icon: "finance",
    paths: ["/modules/finance"],
    nav: [],
  },
];

export function getModule(id: string) {
  return orbitModules.find((module) => module.id === id);
}

export function moduleFromPath(pathname: string) {
  return orbitModules.find((module) =>
    module.paths.some((path) => pathname === path || pathname.startsWith(`${path}/`)),
  );
}

import { Map, Navigation } from "lucide-react";
import { navigationUrls, type SiteAddressInput } from "@/lib/installs/site-nav";

const linkClass = "inline-flex min-h-11 items-center gap-1.5 text-base font-semibold underline decoration-red";

export function SiteNavLinks(input: SiteAddressInput) {
  const links = navigationUrls(input);
  if (!links) return null;
  return (
    <p className="flex flex-wrap gap-x-4">
      <a href={links.waze} target="_blank" rel="noopener noreferrer" className={linkClass}>
        <Navigation className="size-4" aria-hidden="true" />
        Waze
      </a>
      <a href={links.maps} target="_blank" rel="noopener noreferrer" className={linkClass}>
        <Map className="size-4" aria-hidden="true" />
        Google Maps
      </a>
    </p>
  );
}

import { describe, expect, it } from "vitest";
import { multiStopLink, navigationLinks } from "./navigation";

describe("navigation links", () => {
  it("builds Waze and Google Maps directions from the address", () => {
    const links = navigationLinks("1 High Street, Ipswich, PE30 4JJ");
    expect(links).toEqual({
      waze: "https://waze.com/ul?q=1%20High%20Street%2C%20Ipswich%2C%20PE30%204JJ&navigate=yes",
      google: "https://www.google.com/maps/dir/?api=1&destination=1%20High%20Street%2C%20Ipswich%2C%20PE30%204JJ",
    });
  });

  it("returns nothing for a blank address", () => {
    expect(navigationLinks("  ")).toBeNull();
    expect(navigationLinks(null)).toBeNull();
  });

  it("builds a depot-to-stops Google Maps link without changing the single-stop links", () => {
    expect(multiStopLink(["  ", ""])).toBeNull();
    const link = multiStopLink(["1 High Street, Norwich, NR1 1AA", "2 Road, Ipswich, IP1 1AA"]);
    expect(link).toContain("origin=56+Oldmedow+Road");
    expect(link).toContain("PE30+4JJ");
    expect(link).toContain("waypoints=1+High+Street");
    expect(link).toContain("destination=2+Road");
    expect(link).toContain("travelmode=driving");
    expect(navigationLinks("1 High Street, Ipswich, PE30 4JJ")?.google).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=1%20High%20Street%2C%20Ipswich%2C%20PE30%204JJ",
    );
  });
});

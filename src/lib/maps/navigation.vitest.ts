import { describe, expect, it } from "vitest";
import { navigationLinks } from "./navigation";

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
});

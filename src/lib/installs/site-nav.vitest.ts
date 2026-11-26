import { describe, expect, it } from "vitest";
import { navigationAddress, navigationUrls } from "@/lib/installs/site-nav";

describe("site navigation links", () => {
  it("builds Waze and Google Maps links from the address and postcode", () => {
    const address = "1 High Street, King's Lynn, PE30 4JJ";
    const links = navigationUrls({ address: "1 High Street, King's Lynn", postcode: "PE30 4JJ" });
    expect(navigationAddress({ address: "1 High Street, King's Lynn", postcode: "PE30 4JJ" })).toBe(address);
    expect(links?.waze).toBe(`https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes`);
    expect(links?.maps).toBe(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`);
  });

  it("uses coordinates for Waze and still sends the address to Google Maps", () => {
    const links = navigationUrls({
      line1: "1 High Street",
      city: "King's Lynn",
      postcode: "PE30 4JJ",
      latitude: 52.7517,
      longitude: 0.3989,
    });
    expect(links?.waze).toBe("https://waze.com/ul?ll=52.7517,0.3989&navigate=yes");
    expect(links?.maps).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent("1 High Street, King's Lynn, PE30 4JJ")}`,
    );
  });

  it("does not repeat a postcode that is already in the address", () => {
    expect(navigationAddress({ address: "1 High Street, PE30 4JJ", postcode: "pe30  4jj" })).toBe("1 High Street, PE30 4JJ");
  });

  it("hides the links when there is no address", () => {
    expect(navigationUrls({ address: "   ", postcode: "  " })).toBeNull();
    expect(navigationUrls({ latitude: 52.75, longitude: 0.4 })).toBeNull();
    expect(navigationUrls({})).toBeNull();
  });
});

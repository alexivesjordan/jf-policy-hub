import { describe, expect, it } from "vitest";
import { ISO3_TO_ISO2, iso2FromIso3 } from "./iso3166";

/** Origin codes present on active Cin7 products. */
const CIN7_ORIGINS: Record<string, string> = {
  CHN: "CN",
  GBR: "GB",
  GRC: "GR",
  PAK: "PK",
  TWN: "TW",
  ITA: "IT",
  ESP: "ES",
  THA: "TH",
  NOR: "NO",
  USA: "US",
  AUS: "AU",
  LVA: "LV",
  POL: "PL",
  CHE: "CH",
  MYS: "MY",
  IRL: "IE",
  SWE: "SE",
  DEU: "DE",
};

describe("ISO 3166-1 alpha-3", () => {
  it("maps every origin code found on Cin7 products", () => {
    for (const [iso3, iso2] of Object.entries(CIN7_ORIGINS)) {
      expect(iso2FromIso3(iso3), iso3).toBe(iso2);
    }
  });

  it("lists each officially assigned code once", () => {
    const codes = Object.keys(ISO3_TO_ISO2);
    const alpha2 = Object.values(ISO3_TO_ISO2);
    expect(codes).toHaveLength(249);
    expect(new Set(codes).size).toBe(249);
    expect(new Set(alpha2).size).toBe(249);
    expect(codes.every((code) => /^[A-Z]{3}$/.test(code))).toBe(true);
    expect(alpha2.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true);
  });
});

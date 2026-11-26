import { describe, expect, it } from "vitest";
import { DEFAULT_RADAR_SETTINGS } from "@/features/radar/defaults";
import { keywordHits, matchingBand, matchingCpv, scoreOpportunity } from "@/features/radar/scoring";

const config = DEFAULT_RADAR_SETTINGS;

describe("radar scoring", () => {
  it("matches a phrase and a whole word, and skips a longer medical word", () => {
    expect(keywordHits("Supply to the leisure centre", config.keywords)).toContain("leisure centre");
    expect(keywordHits("New gym equipment", ["gym"])).toEqual(["gym"]);
    expect(keywordHits("Cardiology clinic", ["cardio"])).toEqual([]);
    expect(keywordHits("Gymnasium refurbishment", ["gym"])).toEqual([]);
  });

  it("matches a CPV prefix either way", () => {
    expect(matchingCpv(["37421000"], ["3742"])).toBe("3742");
    expect(matchingCpv(["3742"], ["37420000"])).toBe("37420000");
    expect(matchingCpv(["90910000"], ["3742"])).toBeNull();
  });

  it("puts a boundary amount in the higher band only", () => {
    expect(matchingBand(25000, config.valueBands)?.label).toBe("Core supply");
    expect(matchingBand(4999, config.valueBands)).toBeNull();
  });

  it("scores a fitness equipment notice and lists the reasons", () => {
    const result = scoreOpportunity(
      {
        title: "Supply and installation of fitness equipment for a leisure centre",
        description: "Cardio machines and strength equipment",
        buyer: "Test Borough Council",
        cpvCodes: ["37420000"],
        valueAmount: 65000,
      },
      config,
    );
    expect(result.relevant).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.reasons.some((reason) => reason.startsWith("Keyword:"))).toBe(true);
    expect(result.reasons).toContain("CPV 3742");
    expect(result.reasons).toContain("Value in Core supply");
  });

  it("does not keep a value-only or unrelated notice", () => {
    expect(scoreOpportunity({
      title: "Taxi and MPV framework",
      description: "Passenger transport",
      buyer: "County Council",
      cpvCodes: ["60000000"],
      valueAmount: 50000,
    }, config).relevant).toBe(false);
    expect(scoreOpportunity({
      title: "Cleaning contract",
      description: "Cleaning services",
      buyer: "School",
      cpvCodes: [],
      valueAmount: 80000,
    }, config)).toMatchObject({ relevant: false, score: 0, reasons: ["Excluded: cleaning"] });
  });

  it("knocks out a flooring tender that has no equipment signal", () => {
    const result = scoreOpportunity({
      title: "Radmoor Sports Hall Flooring Replacement",
      description: "Replacement of sprung sports hall flooring",
      buyer: "Loughborough College",
      cpvCodes: ["45432100"],
      valueAmount: 500000,
    }, config);
    expect(result.relevant).toBe(false);
    expect(result.reasons).toContain("Excluded: flooring");
  });

  it("keeps an equipment notice that also mentions flooring", () => {
    const result = scoreOpportunity({
      title: "Supply of gym equipment and replacement flooring",
      description: "Fitness equipment for a leisure centre",
      buyer: "Council",
      cpvCodes: ["37420000"],
      valueAmount: 40000,
    }, config);
    expect(result.relevant).toBe(true);
    expect(result.reasons.some((reason) => reason.startsWith("Excluded:"))).toBe(false);
  });

  it("caps the score at 100", () => {
    const noisy = scoreOpportunity({
      title: config.keywords.join(" "),
      description: "gym equipment",
      buyer: "Gym",
      cpvCodes: ["37440000"],
      valueAmount: 40000,
    }, config);
    expect(noisy.score).toBeLessThanOrEqual(100);
  });
});

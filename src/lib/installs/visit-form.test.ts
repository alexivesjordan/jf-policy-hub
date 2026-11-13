import { describe, expect, it } from "vitest";
import { londonLocalToUtcIso } from "@/lib/installs/visit-form";

describe("London visit times", () => {
  it("stores British Summer Time as UTC", () => {
    expect(londonLocalToUtcIso("2026-07-01", "09:00")).toBe("2026-07-01T08:00:00Z");
  });

  it("stores winter time without a shift", () => {
    expect(londonLocalToUtcIso("2026-01-15", "09:00")).toBe("2026-01-15T09:00:00Z");
  });
});

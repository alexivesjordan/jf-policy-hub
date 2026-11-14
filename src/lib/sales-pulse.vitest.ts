import { describe, expect, it } from "vitest";
import { salesPulseHref, salesPulseMeta } from "@/lib/sales-pulse";

describe("sales pulse rows", () => {
  it("links an unbooked quote back to install quoting", () => {
    expect(salesPulseHref({ kind: "quote", orderNumber: "SO-2201" })).toBe("/sales/quote?order=SO-2201");
    expect(salesPulseHref({ kind: "quote", orderNumber: "SO 1/2" })).toBe("/sales/quote?order=SO%201%2F2");
  });

  it("links an install to its sales job", () => {
    expect(salesPulseHref({ kind: "install", id: "11111111-1111-4111-8111-1111111111a1" })).toBe(
      "/sales/installs/11111111-1111-4111-8111-1111111111a1",
    );
    expect(salesPulseHref({ kind: "install", id: "nope" })).toBe("/sales/installs");
  });

  it("keeps the row note short", () => {
    expect(salesPulseMeta({ awaiting: 1 })).toBe("1 sent");
    expect(salesPulseMeta({ awaiting: 2 })).toBe("2 sent");
    expect(salesPulseMeta({ startOn: "2026-11-16" })).toBe("16 Nov");
    expect(salesPulseMeta({})).toBeNull();
  });
});

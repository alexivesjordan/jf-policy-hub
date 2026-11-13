import { describe, expect, it } from "vitest";
import { quoteButtons } from "@/lib/pulse/quote-segment";

describe("sales quote buttons", () => {
  it("stays disabled until a segment is chosen", () => {
    expect(quoteButtons({ orderNumber: "", segment: "", hasPdf: true, pending: null }).jordan.enabled).toBe(false);
    expect(quoteButtons({ orderNumber: "SO-00564", segment: "", hasPdf: false, pending: null }).subcontractor.enabled).toBe(false);
  });

  it("enables both buttons from a PDF and a segment, with no order number", () => {
    const buttons = quoteButtons({ orderNumber: "", segment: "trade", hasPdf: true, pending: null });
    expect(buttons.jordan).toEqual({ enabled: true, label: "Jordan quote" });
    expect(buttons.subcontractor).toEqual({ enabled: true, label: "Subcontractor quote" });
  });

  it("still enables both buttons from a typed order number and a segment", () => {
    const buttons = quoteButtons({ orderNumber: "SO-00564", segment: "independent", hasPdf: false, pending: null });
    expect(buttons.jordan.enabled).toBe(true);
    expect(buttons.subcontractor.enabled).toBe(true);
  });

  it("ignores a blank order number when no PDF is attached", () => {
    const buttons = quoteButtons({ orderNumber: "  ", segment: "franchisee", hasPdf: false, pending: null });
    expect(buttons.jordan.enabled).toBe(false);
    expect(buttons.subcontractor.enabled).toBe(false);
  });

  it("says Drafting only while the subcontractor quote is working", () => {
    const drafting = quoteButtons({ orderNumber: "", segment: "trade", hasPdf: true, pending: "subcontractor" });
    expect(drafting.subcontractor.label).toBe("Drafting");
    expect(drafting.jordan.label).toBe("Jordan quote");
    expect(drafting.jordan.enabled).toBe(false);
    expect(drafting.subcontractor.enabled).toBe(false);
    const calculating = quoteButtons({ orderNumber: "SO-00564", segment: "trade", hasPdf: false, pending: "jordan" });
    expect(calculating.jordan.label).toBe("Calculating…");
    expect(calculating.subcontractor.label).toBe("Subcontractor quote");
  });
});

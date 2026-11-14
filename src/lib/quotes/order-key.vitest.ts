import { describe, expect, it } from "vitest";
import { orderKeyFromPdf, withUnlinkedOrderNote } from "@/lib/quotes/order-key";

describe("PDF order key", () => {
  it("uses an SO number printed on the quote", () => {
    expect(orderKeyFromPdf({
      quoteNumber: "Q-100",
      orderNo: "SO-00490",
      text: "Quote No: Q-100\nOrder No\nSO-00490",
      typed: "",
    })).toEqual({ orderNumber: "SO-00490", source: "so" });
  });

  it("uses a typed SO when the PDF has none", () => {
    expect(orderKeyFromPdf({
      quoteNumber: "Q-100",
      orderNo: null,
      text: "Quote No: Q-100",
      typed: "so-00564",
    })).toEqual({ orderNumber: "SO-00564", source: "typed" });
  });

  it("keeps a printed quote number when nobody wrote an SO", () => {
    expect(orderKeyFromPdf({
      quoteNumber: "Q-100",
      orderNo: null,
      text: "Quote No: Q-100",
      typed: "",
    })).toEqual({ orderNumber: "Q-100", source: "document" });
  });

  it("gives a PDF with no number its own key so it does not block another order", () => {
    const first = orderKeyFromPdf({ quoteNumber: null, orderNo: null, text: "Kit A", typed: "  " });
    const second = orderKeyFromPdf({ quoteNumber: null, orderNo: null, text: "Kit B", typed: "" });
    const again = orderKeyFromPdf({ quoteNumber: "Not provided", orderNo: null, text: "Kit A", typed: "" });
    expect(first.source).toBe("upload");
    expect(first.orderNumber.startsWith("PDF-")).toBe(true);
    expect(second.orderNumber).not.toBe(first.orderNumber);
    expect(again.orderNumber).toBe(first.orderNumber);
    expect(withUnlinkedOrderNote("Install price ready.", first.orderNumber)).toContain("will not block another order");
    expect(withUnlinkedOrderNote("Install price ready.", "SO-00490")).toBe("Install price ready.");
  });
});
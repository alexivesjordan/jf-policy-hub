import { describe, expect, it } from "vitest";
import { assertCin7Get, Cin7RequestBlocked } from "@/lib/cin7/allowlist";

describe("Cin7 purchase reads stay GET-only", () => {
  it("allows a purchase and a purchase search", () => {
    expect(assertCin7Get("GET", "purchase", { ID: "po-1" }).path).toBe("purchase");
    expect(assertCin7Get("GET", "/purchaseList", { Search: "PO-00123", Page: "1", Limit: "100" }).path).toBe("purchaseList");
  });

  it("blocks a purchase write and a purchase list without a search", () => {
    expect(() => assertCin7Get("POST", "purchase", { ID: "po-1" })).toThrow(Cin7RequestBlocked);
    expect(() => assertCin7Get("PUT", "purchaseList", { Search: "PO-1" })).toThrow(Cin7RequestBlocked);
    expect(() => assertCin7Get("GET", "purchase", {})).toThrow(Cin7RequestBlocked);
    expect(() => assertCin7Get("GET", "purchaseList", {})).toThrow(Cin7RequestBlocked);
    expect(() => assertCin7Get("GET", "purchase", { ID: "po-1", Status: "VOIDED" })).toThrow(Cin7RequestBlocked);
  });
});

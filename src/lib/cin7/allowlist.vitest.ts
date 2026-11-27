import { describe, expect, it } from "vitest";
import { assertCin7Get, Cin7RequestBlocked } from "@/lib/cin7/allowlist";

describe("Cin7 purchase reads stay GET-only", () => {
  it("allows a purchase and a purchase search", () => {
    expect(assertCin7Get("GET", "purchase", { ID: "po-1" }).path).toBe("purchase");
    expect(assertCin7Get("GET", "/purchaseList", { Search: "PO-00123", Page: "1", Limit: "100" }).path).toBe("purchaseList");
  });

  it("allows availability, suppliers, and an updated-since list", () => {
    expect(assertCin7Get("GET", "ref/productavailability", { Page: "1", Limit: "100", Location: "Main" }).path).toBe("ref/productavailability");
    expect(assertCin7Get("GET", "/supplier", { Page: "2", Limit: "100" }).path).toBe("supplier");
    expect(assertCin7Get("GET", "saleList", { UpdatedSince: "2024-01-01T00:00:00", Page: "1", Limit: "100" }).path).toBe("saleList");
    expect(assertCin7Get("GET", "purchaseList", { CreatedSince: "2024-01-01T00:00:00", Page: "1" }).path).toBe("purchaseList");
  });

  it("keeps a slash from opening any other path", () => {
    expect(() => assertCin7Get("GET", "ref/productavailability/extra", { Page: "1" })).toThrow(Cin7RequestBlocked);
    expect(() => assertCin7Get("GET", "ref/../productavailability", { Page: "1" })).toThrow(Cin7RequestBlocked);
    expect(() => assertCin7Get("GET", "ref%2fproductavailability", { Page: "1" })).toThrow(Cin7RequestBlocked);
    expect(() => assertCin7Get("GET", "ref/tax", {})).toThrow(Cin7RequestBlocked);
    expect(() => assertCin7Get("POST", "ref/productavailability", { Page: "1" })).toThrow(Cin7RequestBlocked);
    expect(() => assertCin7Get("PUT", "supplier", { ID: "sup-1" })).toThrow(Cin7RequestBlocked);
    expect(() => assertCin7Get("DELETE", "saleList", { UpdatedSince: "2024-01-01T00:00:00" })).toThrow(Cin7RequestBlocked);
    expect(() => assertCin7Get("GET", "supplier", { Name: "Acme" })).toThrow(Cin7RequestBlocked);
    expect(() => assertCin7Get("GET", "ref/productavailability", { ModifiedSince: "2024-01-01" })).toThrow(Cin7RequestBlocked);
  });

  it("blocks a purchase write and a purchase list without a search", () => {
    expect(() => assertCin7Get("POST", "purchase", { ID: "po-1" })).toThrow(Cin7RequestBlocked);
    expect(() => assertCin7Get("PUT", "purchaseList", { Search: "PO-1" })).toThrow(Cin7RequestBlocked);
    expect(() => assertCin7Get("GET", "purchase", {})).toThrow(Cin7RequestBlocked);
    expect(() => assertCin7Get("GET", "purchaseList", {})).toThrow(Cin7RequestBlocked);
    expect(() => assertCin7Get("GET", "purchase", { ID: "po-1", Status: "VOIDED" })).toThrow(Cin7RequestBlocked);
  });
});

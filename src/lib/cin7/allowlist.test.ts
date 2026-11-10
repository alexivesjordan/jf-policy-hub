import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Cin7RequestBlocked, assertCin7Get } from "./allowlist";

describe("Cin7 GET allowlist", () => {
  it("allows the pricing reads", () => {
    assert.equal(assertCin7Get("GET", "sale", { ID: "sale-1" }).path, "sale");
    assert.equal(assertCin7Get("get", "/saleList", { Search: "SO-00490" }).path, "saleList");
    assert.equal(assertCin7Get("GET", "product", { Sku: "JF-C2SE-2" }).path, "product");
    assert.equal(assertCin7Get("GET", "product", { Page: "2", Limit: "100", IncludeDeprecated: "false" }).path, "product");
    assert.equal(assertCin7Get("GET", "customer", { ID: "cust-1" }).path, "customer");
  });

  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    it(`blocks ${method} before any call`, () => {
      assert.throws(() => assertCin7Get(method, "sale", { ID: "sale-1" }), Cin7RequestBlocked);
    });
  }

  for (const path of ["me", "sale/invoice", "Products", "ref/tax", "productFamily", "../sale", "sale?ID=1", "customer/Name"]) {
    it(`blocks unlisted path ${path}`, () => {
      assert.throws(() => assertCin7Get("GET", path, {}), Cin7RequestBlocked);
    });
  }

  it("blocks filters that are not needed for pricing", () => {
    assert.throws(() => assertCin7Get("GET", "saleList", {}), Cin7RequestBlocked);
    assert.throws(() => assertCin7Get("GET", "customer", { Name: "Someone" }), Cin7RequestBlocked);
    assert.throws(() => assertCin7Get("GET", "product", { Name: "Bench", IncludeBOM: "true" }), Cin7RequestBlocked);
    assert.throws(() => assertCin7Get("GET", "sale", { ID: "sale-1", Void: "true" }), Cin7RequestBlocked);
  });
});

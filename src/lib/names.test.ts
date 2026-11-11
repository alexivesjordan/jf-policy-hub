import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { derivedFullName, personName, splitPersonName } from "./names";

describe("person names", () => {
  it("splits at the first space and keeps the rest as the last name", () => {
    assert.deepEqual(splitPersonName("Mary Ann Smith"), { firstName: "Mary", lastName: "Ann Smith" });
    assert.deepEqual(splitPersonName("  Alex   Ives "), { firstName: "Alex", lastName: "Ives" });
  });

  it("leaves a single token as the first name", () => {
    assert.deepEqual(splitPersonName("Alex"), { firstName: "Alex", lastName: "" });
  });

  it("leaves an email-only row blank", () => {
    assert.deepEqual(splitPersonName(null), { firstName: "", lastName: "" });
    assert.deepEqual(splitPersonName("   "), { firstName: "", lastName: "" });
  });

  it("requires both names when someone edits or is invited", () => {
    assert.equal(personName("Alex", ""), null);
    assert.deepEqual(personName(" Alex ", " Ives "), { firstName: "Alex", lastName: "Ives" });
    assert.equal(derivedFullName("Alex", "Ives"), "Alex Ives");
    assert.equal(derivedFullName("", ""), null);
  });
});

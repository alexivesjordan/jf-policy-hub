import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyByText, classifyLine } from "./classify";

describe("service classification", () => {
  it("follows the reference categories from the description", () => {
    assert.equal(classifyByText("Jordan Elite TFT treadmills"), "jordan_cardio");
    assert.equal(classifyByText("Concept2 RowErg"), "concept2_cardio");
    assert.equal(classifyByText("Miscellaneous DHZ (Add Description)"), "unresolved_dhz");
    assert.equal(classifyByText("Dumbbell set"), "loose_accessory");
    assert.equal(classifyByText("Delivery"), "delivery_install");
    assert.equal(classifyByText("Something entirely unnamed"), "unknown_product");
  });

  it("lets an owner mapping win over the text rule", () => {
    const result = classifyLine(
      { sku: "JF-1", description: "Something entirely unnamed" },
      [{ matchKind: "sku", matchValue: "JF-1", category: "strength_machine", priority: 1 }],
    );
    assert.equal(result.category, "strength_machine");
    assert.deepEqual(result.reasons, []);
  });

  it("flags unresolved DHZ with the skill reason", () => {
    const result = classifyLine({ description: "DHZ item missing model 1" });
    assert.equal(result.category, "unresolved_dhz");
    assert.match(result.reasons[0] ?? "", /provisional DHZ/);
  });
});

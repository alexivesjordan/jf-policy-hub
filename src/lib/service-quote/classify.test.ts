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

  it("uses the install effort category before the text rule", () => {
    assert.equal(classifyLine({ sku: "JF-SB-05", description: "JORDAN Black Slam Ball - 5kg" }).category, "loose_accessory");
    assert.equal(
      classifyLine({ sku: "JTRBARSN2-1N-RC", description: "JORDAN 10 - 45kg Rubber Fixed Barbell (5kg increments / 10 Bars) - Straight Bar - Red" }).category,
      "loose_accessory",
    );
    assert.equal(
      classifyLine({ sku: "JF-PS-PIN-LPD-BLK", description: "JORDAN Performance  Strength - Pin Loaded Lat Pulldown - Black" }).category,
      "strength_machine",
    );
    assert.equal(classifyLine({ sku: "JF-C2SE-FS-2", description: "Concept2 SkiErg Floor Stand" }).category, "loose_accessory");
    const unnamed = classifyLine({ description: "JORDAN Miscellaneous DHZ (Add Description)", sku: "JL-DMISC" });
    assert.equal(unnamed.category, "unresolved_dhz");
    assert.match(unnamed.reasons[0] ?? "", /provisional DHZ/);
  });

  it("uses a Cin7 category when the effort table does not know the product", () => {
    const result = classifyLine({ sku: "NEW-1", description: "Unlisted commercial unit", cin7Category: "Treadmills" });
    assert.equal(result.category, "jordan_cardio");
    assert.equal(classifyLine({ description: "Unlisted commercial unit", cin7Category: "Other" }).category, "unknown_product");
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

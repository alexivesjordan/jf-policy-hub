import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CHARGES_HEADING, TermsAcceptBox } from "./terms-accept";

describe("access form terms tick", () => {
  it("names the charges without the internal version", () => {
    assert.equal(CHARGES_HEADING, "Additional charges (ex VAT)");
    assert.equal(CHARGES_HEADING.includes("v1"), false);
    assert.equal(CHARGES_HEADING.includes("version"), false);
  });

  it("can be ticked with a click or the keyboard once the charges have been read", () => {
    const html = renderToStaticMarkup(<TermsAcceptBox ready versionLabel="v1-original" />);
    assert.match(html, /type="checkbox"/);
    assert.match(html, /name="accept"/);
    assert.match(html, /value="yes"/);
    assert.match(html, /id="access-terms-accept"/);
    assert.match(html, /for="access-terms-accept"/);
    assert.equal(html.includes("disabled"), false);
    assert.equal(html.includes('tabindex="-1"'), false);
  });

  it("stays disabled until the end of the charges list has been reached", () => {
    const html = renderToStaticMarkup(<TermsAcceptBox ready={false} versionLabel="v1-original" />);
    assert.match(html, /disabled=""/);
  });
});

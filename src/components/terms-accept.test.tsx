import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";
import { CHARGES_HEADING, TermsAcceptBox } from "./terms-accept";

describe("access form terms tick", () => {
  it("names the charges without the internal version", () => {
    assert.equal(CHARGES_HEADING, "Additional charges (ex VAT)");
    assert.equal(CHARGES_HEADING.includes("v1"), false);
    assert.equal(CHARGES_HEADING.includes("version"), false);
  });

  it("is always enabled, with no scroll gate and no second label target", () => {
    const html = renderToStaticMarkup(createElement(TermsAcceptBox, { versionLabel: "v1-original" }));
    assert.match(html, /type="checkbox"/);
    assert.match(html, /name="accept"/);
    assert.match(html, /value="yes"/);
    assert.equal(html.includes("disabled"), false);
    assert.equal(html.includes("htmlFor"), false);
    assert.equal(html.includes('tabindex="-1"'), false);
    assert.equal(html.includes("checked="), false);
  });

  it("ticks when the box is clicked and when the words beside it are clicked", () => {
    const html = renderToStaticMarkup(createElement(TermsAcceptBox, { versionLabel: "v1-original" }));
    const window = new Window({ url: "http://localhost/" });
    window.document.body.innerHTML = `<form>${html}</form>`;
    const box = window.document.querySelector("input[type=checkbox]");
    const words = window.document.querySelector("label span");
    const form = window.document.querySelector("form");
    assert.ok(box instanceof window.HTMLInputElement);
    assert.ok(words instanceof window.HTMLElement);
    assert.ok(form);
    assert.equal(box.disabled, false);
    assert.equal(String(box.className).includes("pointer-events-none"), false);
    assert.equal(box.checked, false);

    box.click();
    assert.equal(box.checked, true);
    assert.equal(new window.FormData(form).get("accept"), "yes");

    box.checked = false;
    words.click();
    assert.equal(box.checked, true);
    assert.equal(new window.FormData(form).get("accept"), "yes");

    box.checked = false;
    const space = new window.KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true });
    box.dispatchEvent(space);
    assert.equal(space.defaultPrevented, false);
  });
});

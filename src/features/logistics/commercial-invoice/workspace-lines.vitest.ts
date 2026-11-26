// @vitest-environment happy-dom
import { act, Component, createElement, type ReactNode } from "react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { CommercialInvoiceWorkspace } from "@/components/logistics/commercial-invoice-workspace";
import { incomingDraft } from "./retrieve";
import { goodsTotal, summedNetWeightKg, type InvoiceDraft, type InvoiceOrder } from "./rules";

class CrashBoundary extends Component<{ children: ReactNode }, { message: string }> {
  state = { message: "" };

  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }

  render() {
    if (this.state.message) return createElement("p", { role: "alert" }, this.state.message);
    return this.props.children;
  }
}

function order(lines: InvoiceOrder["lines"]): InvoiceOrder {
  return {
    id: "sale-1",
    orderNumber: "SO-1",
    buyer: { name: "NonStop Gym SA", address: "Rue de Cornavin", vat: null as unknown as string, eori: null as unknown as string },
    consignee: { name: "NonStop Gym SA", address: "Rue de Cornavin", vat: "", eori: "" },
    country: "CH",
    currency: "CHF",
    warnings: [],
    lines,
    deliveryCity: "Genève",
  };
}

function line(partial: Partial<InvoiceOrder["lines"][number]> & Pick<InvoiceOrder["lines"][number], "id" | "sku">): InvoiceOrder["lines"][number] {
  return {
    orderNumber: "SO-1",
    productName: "Bench",
    orderedQuantity: 4,
    shippedQuantity: 4,
    unitNetValue: 10,
    hsCode: "9506910000",
    originCountry: "CN",
    unitWeightKg: 1,
    ...partial,
  };
}

function mount(draft: InvoiceDraft) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  act(() => {
    root.render(createElement(CrashBoundary, null, createElement(CommercialInvoiceWorkspace, {
      prefill: {
        orderNumbers: "SO-1",
        draft,
        pallets: [{ lengthCm: "", widthCm: "", depthCm: "", weightKg: "", kind: "parcel" }],
      },
    })));
  });
  return {
    root,
    unmount() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

function lineCard(sku: string) {
  const card = [...document.querySelectorAll("div")].find((node) => {
    const title = node.querySelector(":scope > p");
    return Boolean(title?.textContent?.includes(sku) && node.querySelector("input"));
  });
  if (!card) throw new Error("missing line " + sku);
  return card;
}

function labelledInput(scope: ParentNode, label: string) {
  const match = [...scope.querySelectorAll("label")].find((node) => node.textContent?.includes(label));
  const input = match?.querySelector("input, textarea, select");
  if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement)) {
    throw new Error("missing " + label);
  }
  return input;
}

function typeInto(input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  act(() => {
    const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function totalsText() {
  return (document.body.textContent ?? "").match(/Goods [\d.]+ CHF · Net [\d.]+ kg/)?.[0] ?? "";
}

describe("commercial invoice line editing", () => {
  const mounted: Array<{ unmount(): void }> = [];
  const consoleError = console.error;

  afterEach(() => {
    console.error = consoleError;
    mounted.splice(0).forEach((view) => view.unmount());
  });

  it("keeps the page up when an empty HS code, origin, weight or description is edited", () => {
    const notices: string[] = [];
    console.error = (...args: unknown[]) => {
      notices.push(args.map((item) => String(item)).join(" "));
    };
    const draft = incomingDraft([order([
      line({ id: "blank", sku: "JF-BLANK", productName: null as unknown as string, hsCode: null as unknown as string, originCountry: null as unknown as string, unitWeightKg: null, shippedQuantity: 2, orderedQuantity: 2 }),
      line({ id: "empty", sku: "JF-EMPTY", productName: "Cable", hsCode: "", originCountry: "", unitWeightKg: null, shippedQuantity: 1, orderedQuantity: 1, unitNetValue: 5 }),
      line({ id: "filled", sku: "JF-FILLED", productName: "Rack", hsCode: "9506910000", originCountry: "CN", unitWeightKg: 1, shippedQuantity: 3, orderedQuantity: 3, unitNetValue: 4 }),
    ])]);
    mounted.push(mount(draft));
    const blank = lineCard("JF-BLANK");
    const empty = lineCard("JF-EMPTY");
    const filled = lineCard("JF-FILLED");

    expect(blank.textContent).toContain("JF-BLANK");
    expect(labelledInput(blank, "HS code").value).toBe("");
    expect(labelledInput(blank, "Origin").value).toBe("");
    expect(labelledInput(blank, "Unit kg").value).toBe("");
    expect(labelledInput(empty, "HS code").value).toBe("");
    expect(labelledInput(filled, "HS code").value).toBe("9506910000");
    expect(document.querySelector("[role=alert]")).toBeNull();

    const goodsBefore = totalsText();
    typeInto(labelledInput(blank, "HS code"), "95069190");
    typeInto(labelledInput(empty, "HS code"), "9506 91");
    typeInto(labelledInput(filled, "HS code"), "9506910000");
    typeInto(labelledInput(blank, "Origin"), "es");
    typeInto(labelledInput(empty, "Origin"), "cn");
    expect(totalsText()).toBe(goodsBefore);

    typeInto(labelledInput(blank, "Unit kg"), "2");
    typeInto(labelledInput(empty, "Unit kg"), "");
    typeInto(labelledInput(blank, "Shipped qty"), "2");
    typeInto(labelledInput(document.body, "Buyer VAT"), "CHE-999");

    expect(document.querySelector("[role=alert]")).toBeNull();
    expect(document.body.textContent).toContain("Invoice");
    expect(labelledInput(blank, "HS code").value).toBe("95069190");
    expect(labelledInput(empty, "HS code").value).toBe("9506 91");
    expect(labelledInput(filled, "HS code").value).toBe("9506910000");
    expect(labelledInput(blank, "Origin").value).toBe("ES");
    expect(labelledInput(empty, "Origin").value).toBe("CN");
    expect(labelledInput(blank, "Unit kg").value).toBe("2");
    expect(labelledInput(empty, "Unit kg").value).toBe("");
    expect(labelledInput(blank, "Shipped qty").value).toBe("2");
    expect(labelledInput(document.body, "Buyer VAT").value).toBe("CHE-999");
    expect(notices.join("\n")).not.toMatch(/should not be null|uncontrolled input|Cannot read properties of null/);
  });

  it("leaves the goods total on the existing calculation when only customs fields change", () => {
    const draft = incomingDraft([order([
      line({ id: "blank", sku: "JF-BLANK", hsCode: null as unknown as string, originCountry: null as unknown as string, unitWeightKg: null, shippedQuantity: 2, orderedQuantity: 2, unitNetValue: 10 }),
      line({ id: "filled", sku: "JF-FILLED", hsCode: "9506910000", originCountry: "CN", unitWeightKg: 1, shippedQuantity: 3, orderedQuantity: 3, unitNetValue: 4 }),
    ])]);
    const priced = structuredClone(draft);
    priced.lines[0] = { ...priced.lines[0]!, hsCode: "95069190", originCountry: "ES", unitWeightKg: 2 };
    mounted.push(mount(draft));
    const blank = lineCard("JF-BLANK");
    typeInto(labelledInput(blank, "HS code"), "95069190");
    typeInto(labelledInput(blank, "Origin"), "es");
    typeInto(labelledInput(blank, "Unit kg"), "2");
    expect(totalsText()).toBe(`Goods ${goodsTotal(priced).toFixed(2)} CHF · Net ${summedNetWeightKg(priced.lines).toFixed(3)} kg`);
  });
});

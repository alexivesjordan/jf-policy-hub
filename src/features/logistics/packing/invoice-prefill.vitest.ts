// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { CommercialInvoiceWorkspace } from "@/components/logistics/commercial-invoice-workspace";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("pack estimate on the commercial invoice", () => {
  const mounted: Root[] = [];

  afterEach(() => {
    mounted.splice(0).forEach((root) => act(() => root.unmount()));
  });

  it("fills the dimension rows and leaves them editable", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push(root);
    act(() => {
      root.render(createElement(CommercialInvoiceWorkspace, {
        pack: {
          orderNumbers: "SO-00779",
          rows: [
            { lengthCm: "40", widthCm: "30", depthCm: "20", weightKg: "8", kind: "parcel" },
            { lengthCm: "120", widthCm: "100", depthCm: "45", weightKg: "80", kind: "pallet" },
          ],
        },
      }));
    });
    const order = host.querySelector("#invoice-orders");
    expect(order).toBeInstanceOf(HTMLTextAreaElement);
    expect((order as HTMLTextAreaElement).value).toBe("SO-00779");
    const lengths = [...host.querySelectorAll("input[aria-label='Length cm']")] as HTMLInputElement[];
    const kinds = [...host.querySelectorAll("select")] as HTMLSelectElement[];
    expect(lengths.map((input) => input.value)).toEqual(["40", "120"]);
    expect(kinds.map((input) => input.value)).toEqual(["parcel", "pallet"]);
    act(() => {
      const input = lengths[0]!;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      set?.call(input, "41");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect((host.querySelector("input[aria-label='Length cm']") as HTMLInputElement).value).toBe("41");
    host.remove();
  });
});

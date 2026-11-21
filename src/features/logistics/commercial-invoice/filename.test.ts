import { describe, expect, it } from "vitest";
import { commercialInvoiceFileName } from "./filename";

describe("commercial invoice file name", () => {
  it("uses the issued name", () => {
    expect(commercialInvoiceFileName({
      buyer: "Acme Gyms Ltd",
      number: "CI-2026-0001",
      incoterm: "DAP",
    })).toBe("Commercial Invoice - Acme Gyms Ltd - CI-2026-0001 - DAP.pdf");
  });

  it("uses PREVIEW and strips only illegal filename characters", () => {
    expect(commercialInvoiceFileName({
      buyer: "Acme/Gyms: Ltd",
      number: "PREVIEW",
      incoterm: "DDP",
    })).toBe("Commercial Invoice - AcmeGyms Ltd - PREVIEW - DDP.pdf");
  });
});

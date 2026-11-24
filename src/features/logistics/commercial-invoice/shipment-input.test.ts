import { describe, expect, it } from "vitest";
import { commercialInvoiceBody, issueBodySchema, previewBodySchema, schemaIssuePaths, shipmentSchema } from "./shipment-input";
import type { InvoiceDraft } from "./rules";

describe("shipment input limits", () => {
  it("accepts an ISO despatch date and a real email", () => {
    expect(shipmentSchema.safeParse({ despatchDate: "2026-11-21", contactEmail: "alex@jordanfitness.com" }).success).toBe(true);
    expect(shipmentSchema.safeParse({ despatchDate: "", contactEmail: "" }).success).toBe(true);
  });

  it("rejects a bad date, a bad email and values above the caps", () => {
    expect(shipmentSchema.safeParse({ despatchDate: "2026-02-31" }).success).toBe(false);
    expect(shipmentSchema.safeParse({ despatchDate: "19/11/2026" }).success).toBe(false);
    expect(shipmentSchema.safeParse({ contactEmail: "not-an-email" }).success).toBe(false);
    expect(shipmentSchema.safeParse({ deliveryPence: 100_000_001 }).success).toBe(false);
    expect(shipmentSchema.safeParse({ surchargePence: 100_000_000 }).success).toBe(true);
    expect(shipmentSchema.safeParse({ vatPence: 100_000_000 }).success).toBe(true);
    expect(shipmentSchema.safeParse({ parcels: 1000 }).success).toBe(false);
    expect(shipmentSchema.safeParse({ pallets: 30 }).success).toBe(true);
    expect(shipmentSchema.safeParse({ pallets: 31 }).success).toBe(false);
    expect(shipmentSchema.safeParse({ palletLines: [{ lengthCm: 1001, widthCm: 1, depthCm: 1, weightKg: 1 }] }).success).toBe(true);
    expect(shipmentSchema.safeParse({ palletLines: [{ lengthCm: 120, widthCm: 100, depthCm: 150, weightKg: null }] }).success).toBe(true);
    expect(shipmentSchema.safeParse({ palletLines: Array.from({ length: 31 }, () => ({ lengthCm: 1, widthCm: 1, depthCm: 1, weightKg: 1 })) }).success).toBe(false);
    expect(shipmentSchema.safeParse({ grossWeightKg: 100000 }).success).toBe(true);
    expect(shipmentSchema.safeParse({ grossWeightKg: 100001 }).success).toBe(false);
    expect(shipmentSchema.safeParse({ grossWeightKg: -1 }).success).toBe(false);
  });

  it("accepts the form payload for a one-line DAP invoice and rejects issuedAt", () => {
    const draft: InvoiceDraft = {
      reference: "PREVIEW",
      issueDate: "2026-11-23",
      currency: "GBP",
      orders: ["SO-00819"],
      seller: { name: "Jordan Fitness Ltd", address: "", vat: "", eori: "" },
      buyer: { name: "Alpine Gym", address: "1 Road", vat: "", eori: "" },
      consignee: { name: "Alpine Gym", address: "1 Road, Geneva", vat: "", eori: "" },
      importer: { name: "", address: "", vat: "", eori: "" },
      frenchVatNumber: "",
      frenchFiscalRepresentativeVat: "",
      ddpModel: "not_applicable",
      carrier: "Other",
      entryCountry: "",
      clearanceCountry: "",
      destinationCountry: "CH",
      incoterm: "DAP",
      namedPlace: "Geneva",
      procedure: "unconfirmed",
      approvedStatement: "",
      statementApprovedBy: "",
      reasonForExport: "Sale of goods",
      packages: 1,
      packageType: "Pallet",
      netWeightKg: 12,
      grossWeightKg: 12,
      freightValue: 0,
      insuranceValue: 0,
      otherChargesValue: 0,
      shipmentRef: "",
      signatory: "Jordan Fitness Ltd",
      notes: "",
      physicalShipmentConfirmed: true,
      lines: [{
        id: "line-1",
        orderNumber: "SO-00819",
        sku: "JF-SFM-BLK-10-1200",
        productName: "Studio functional machine",
        orderedQuantity: 1,
        shippedQuantity: 1,
        unitNetValue: 10,
        hsCode: "",
        originCountry: "",
        unitWeightKg: 12,
      }],
      shipment: {
        fao: "",
        courier: "",
        despatchDate: "2026-11-23",
        deliveryAddress: "1 Road, Geneva",
        contactName: "",
        contactEmail: "",
        specialInstructions: "",
        parcels: 1,
        pallets: 0,
        palletLines: [],
        deliveryPence: 0,
        surchargePence: 0,
        vatPence: 0,
        customsStatementId: "matched",
        customsStatementText: "",
        issuedAt: "2026-11-23T09:00:00.000Z",
      },
    };
    const pallets = [
      { kind: "parcel" as const, lengthCm: 20, widthCm: 14, depthCm: 133, weightKg: 33 },
      { kind: "parcel" as const, lengthCm: 46, widthCm: 9, depthCm: 84, weightKg: 10 },
    ];
    const body = commercialInvoiceBody(draft, pallets, 0, 43);
    expect(body.shipment).not.toHaveProperty("issuedAt");
    expect(body.shipment).toMatchObject({ parcels: 2, pallets: 0, palletLines: pallets });
    expect(previewBodySchema.safeParse(body).success).toBe(true);
    const issue = issueBodySchema.safeParse({ ...body, idempotencyKey: "00000000-0000-4000-8000-000000000001" });
    expect(issue.success).toBe(true);
    const leaked = previewBodySchema.safeParse({ ...body, shipment: { ...body.shipment, issuedAt: draft.shipment?.issuedAt } });
    expect(leaked.success).toBe(false);
    if (!leaked.success) {
      const paths = schemaIssuePaths(leaked.error);
      expect(paths).toContain("shipment.issuedAt");
      expect(paths.join(" ")).not.toContain("2026-11-23T09:00:00.000Z");
    }
  });
});
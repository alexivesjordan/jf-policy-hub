import { describe, expect, it } from "vitest";
import {
  mergeInvoiceOrders, parseOrderNumbers, validateCommercialInvoice, goodsTotal, isGoodsLine,
  vatCountryPrefix, shippedLinePence, withinInvoiceTolerance, summedNetWeightKg, toPence, normaliseHsCode,
  type InvoiceOrder,
} from "./rules";

const seller={name:"Jordan Fitness Ltd",address:"King's Lynn, United Kingdom",vat:"GB385438070",eori:"GB385438070001"};
const party={name:"Example Buyer",address:"Rotterdam, Netherlands",vat:"NL123456789B01",eori:"NL123456789"};
function order(number:string,country="NL"):InvoiceOrder {
  const p={...party,address:country==="FR"?"Paris, France":"Rotterdam, Netherlands",vat:country+"123456789B01"};
  return {id:number,orderNumber:number,buyer:p,consignee:{...p},country,currency:"GBP",
    warnings:[],lines:[{id:number+"-1",orderNumber:number,sku:"JF-EX1",productName:"Gym bench",
      orderedQuantity:2,shippedQuantity:2,unitNetValue:145.5,hsCode:"950691",
      originCountry:"CN",unitWeightKg:30}]};
}
function validDraft() {
  const d=mergeInvoiceOrders([order("SO-001")],seller);
  d.reference="CI-0001";d.issueDate="2026-11-19";
  d.importer={...seller};
  d.frenchVatNumber="FR12345678901";
  d.carrier="Europa";d.entryCountry="FR";d.ddpModel="own_french_vat";
  d.incoterm="DDP";d.namedPlace="Rotterdam, NL";d.clearanceCountry="FR";
  d.procedure="42";d.approvedStatement="Approved illustrative statement";
  d.statementApprovedBy="Authorised customs reviewer";
  d.packages=2;d.packageType="Pallets";d.netWeightKg=60;d.grossWeightKg=70;
  d.signatory="Jordan Representative";d.physicalShipmentConfirmed=true;
  return d;
}
describe("Pulse Logistics commercial invoice rules",()=>{
  it("normalises multiple order number input",()=>expect(parseOrderNumbers("so-1, SO-2;so-3")).toEqual(["SO-1","SO-2","SO-3"]));
  it("blocks duplicate order numbers",()=>expect(()=>parseOrderNumbers("SO-1 SO-1")).toThrow(/Duplicate/));
  it("keeps separate line provenance when consolidating",()=>{
    const d=mergeInvoiceOrders([order("SO-001"),order("SO-002")],seller);
    expect(d.lines.map(l=>l.orderNumber)).toEqual(["SO-001","SO-002"]);
    expect(goodsTotal(d)).toEqual(582);
  });
  it("never merges different consignees",()=>{
    const other=order("SO-002");other.consignee.address="Another place";
    expect(()=>mergeInvoiceOrders([order("SO-001"),other],seller)).toThrow(/consignees/);
  });
  it("defaults to no inferred carrier or customs procedure",()=>{
    const d=mergeInvoiceOrders([order("SO-001")],seller);
    expect(d.carrier).toBe("Other"); expect(d.entryCountry).toBe("");
    expect(d.ddpModel).toBe("not_applicable");expect(d.procedure).toBe("unconfirmed");
  });
  it("validates approved France to Netherlands procedure 42 configuration",()=>{
    const d=validDraft();
    expect(validateCommercialInvoice(d)).toEqual([]);
  });
  it("rejects French destination under procedure 42",()=>{
    const d=validDraft();d.destinationCountry="FR";
    expect(validateCommercialInvoice(d).join(" ")).toMatch(/different EU destination/);
  });
  it("blocks missing customer's destination VAT under procedure 42",()=>{
    const d=validDraft();d.buyer.vat="";
    expect(validateCommercialInvoice(d).join(" ")).toMatch(/buyer VAT/);
  });
  it("blocks missing customs statement review",()=>{
    const d=validDraft();d.statementApprovedBy="";
    expect(validateCommercialInvoice(d).join(" ")).toMatch(/reviewer/);
  });
  it("rejects mismatched or oversized dispatched quantities",()=>{
    const d=validDraft();d.lines[0].shippedQuantity=3;
    expect(validateCommercialInvoice(d).join(" ")).toMatch(/shipped quantity/);
  });
  it("issues DDP with only the customs statement and no importer or clearance", () => {
    const d = validDraft();
    d.procedure = "unconfirmed";
    d.ddpModel = "not_applicable";
    d.importer = { name: "", address: "", vat: "", eori: "" };
    d.clearanceCountry = "";
    d.approvedStatement = "";
    d.statementApprovedBy = "";
    d.carrier = "Other";
    d.frenchVatNumber = "";
    expect(validateCommercialInvoice(d)).toEqual([]);
  });
  it("still checks a filled Europa French DDP model", () => {
    const d = validDraft();
    d.ddpModel = "importers_signature";
    d.importer = { ...d.seller };
    expect(validateCommercialInvoice(d).join(" ")).toMatch(/EU importer/);
  });
  it("rejects a gross weight above 100000 kg", () => {
    const d = validDraft();
    d.grossWeightKg = 100001;
    expect(validateCommercialInvoice(d).join(" ")).toMatch(/too large/);
  });
  it("blocks missing currency",()=>{
    const d=validDraft();d.currency="";
    expect(validateCommercialInvoice(d).join(" ")).toMatch(/currency/);
  });
  it("uses EL for Greek VAT", () => {
    expect(vatCountryPrefix("GR")).toBe("EL");
    expect(vatCountryPrefix("FR")).toBe("FR");
    const d = validDraft();
    d.destinationCountry = "GR";
    d.buyer.vat = "GR123456789";
    expect(validateCommercialInvoice(d).join(" ")).toMatch(/buyer VAT/);
    d.buyer.vat = "EL123456789";
    expect(validateCommercialInvoice(d).join(" ")).not.toMatch(/buyer VAT/);
  });
  it("excludes service, install, freight and delivery lines", () => {
    expect(isGoodsLine({ sku: "JF-1", productName: "Gym bench" })).toBe(true);
    expect(isGoodsLine({ productName: "Installation" })).toBe(false);
    expect(isGoodsLine({ productName: "Delivery charge" })).toBe(false);
    expect(isGoodsLine({ sku: "FREIGHT", productName: "Outbound freight" })).toBe(false);
    expect(isGoodsLine({ productName: "Service call" })).toBe(false);
  });
  it("sums line weights and reconciles pence within £10", () => {
    const d = validDraft();
    expect(summedNetWeightKg(d.lines)).toBe(60);
    const line = d.lines[0];
    expect(shippedLinePence(line)).toBe(toPence(291));
    expect(withinInvoiceTolerance(1000, 0)).toBe(true);
    expect(withinInvoiceTolerance(1001, 0)).toBe(false);
    expect(normaliseHsCode("9506.91")).toBe("9506910000");
  });
  it("apportions partial shipments by largest remainder so they sum to the Cin7 total", () => {
    const base = { ...validDraft().lines[0], orderedQuantity: 3, lineNetPence: 100, unitNetValue: 100 / 300 };
    const first = shippedLinePence({ ...base, shippedQuantity: 1 }, 0);
    const second = shippedLinePence({ ...base, shippedQuantity: 1 }, 1);
    const third = shippedLinePence({ ...base, shippedQuantity: 1 }, 2);
    expect(first).toBe(34);
    expect(second).toBe(33);
    expect(third).toBe(33);
    expect(first + second + third).toBe(100);
    expect(shippedLinePence({ ...base, shippedQuantity: 2 }, 0)).toBe(67);
  });
  it("refuses a shipment above the remaining quantity", () => {
    const d = validDraft();
    const line = { ...d.lines[0], shippedQuantity: 1 };
    expect(() => shippedLinePence(line, 2)).toThrow(/remaining/);
  });
});

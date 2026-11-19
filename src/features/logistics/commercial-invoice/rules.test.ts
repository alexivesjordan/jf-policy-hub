import { describe, expect, it } from "vitest";
import { mergeInvoiceOrders, parseOrderNumbers, validateCommercialInvoice, goodsTotal, type InvoiceOrder } from "./rules";

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
  d.ddpModel="own_french_vat";
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
  it("defaults to unconfirmed procedure and unspecified Europa Flow model",()=>{
    const d=mergeInvoiceOrders([order("SO-001")],seller);
    expect(d.carrier).toBe("Europa"); expect(d.entryCountry).toBe("FR");
    expect(d.ddpModel).toBe("unspecified");expect(d.procedure).toBe("unconfirmed");
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
  it("does not treat a DDP order as proof of procedure 42",()=>{
    const d=validDraft();d.procedure="unconfirmed";
    expect(validateCommercialInvoice(d).join(" ")).toMatch(/must be confirmed/);
  });
  it("blocks missing currency",()=>{
    const d=validDraft();d.currency="";
    expect(validateCommercialInvoice(d).join(" ")).toMatch(/currency/);
  });
});

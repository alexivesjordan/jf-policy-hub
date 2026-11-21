/** Server-side seller. The commercial invoice form cannot change these. */
export const COMMERCIAL_INVOICE_SELLER = {
  name: "Jordan Fitness Ltd",
  address: "56 Oldmedow Road, Hardwick Industrial Estate, King's Lynn, PE30 4JJ",
  lines: ["56 Oldmedow Road", "Hardwick Industrial Estate", "King's Lynn", "Norfolk", "PE30 4JJ"],
  phone: "01553 763285",
  website: "www.jordanfitness.com",
  email: "sales@jordanfitness.com",
  vat: "GB385438070",
  eoriGb: "GB385438070001",
  eoriFr: "FRGB1215443160001",
  companyNumber: "12798165",
} as const;

/** Optional marks. Leave the files absent until a real signature or stamp is supplied. */
export const COMMERCIAL_INVOICE_MARKS = {
  signatureFile: "public/brand/commercial-invoice-signature.png",
  stampFile: "public/brand/commercial-invoice-stamp.png",
} as const;

export const CUSTOMS_STATEMENTS = [
  {
    id: "regime42",
    label: "Regime 42",
    text: "Regime 42 Statement: 'Goods transported under Regime 42-00, intra-community supply, Article 138 EU VAT Directive'",
  },
  {
    id: "ddp_vat_postponed",
    label: "DDP VAT postponed",
    text: "Goods cleared regime 40 00 DDP VAT postponed by Frictionless Trade Services SAS, 70 Rue Mollien 62100 Calais, France\nDDP – VAT Postponed",
  },
  { id: "none", label: "None", text: "" },
  { id: "custom", label: "Custom", text: "" },
] as const;

export type CustomsStatementId = (typeof CUSTOMS_STATEMENTS)[number]["id"];

export function resolveCustomsStatement(id: string, custom: string) {
  if (id === "custom") return custom.trim();
  return CUSTOMS_STATEMENTS.find((item) => item.id === id)?.text ?? "";
}

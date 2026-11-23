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

/** Declaration marks. Server files only; they are not served from /public. */
export const COMMERCIAL_INVOICE_MARKS = {
  signatureFile: "src/features/logistics/commercial-invoice/assets/signature.png",
  printedNameFile: "src/features/logistics/commercial-invoice/assets/printed-name.png",
  stampFile: "src/features/logistics/commercial-invoice/assets/stamp.png",
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
  if (id === "custom" || id === "matched") return custom.trim();
  if (id === "none") return "";
  return CUSTOMS_STATEMENTS.find((item) => item.id === id)?.text ?? "";
}

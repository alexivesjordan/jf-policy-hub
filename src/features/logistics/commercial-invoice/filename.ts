const ILLEGAL = /[/\\:*?"<>|]/g;

function clean(value: string) {
  return value.replace(ILLEGAL, "").replace(/\s+/g, " ").trim();
}

/** Alex's download name. Spaces and " - " stay; only illegal filename characters are removed. */
export function commercialInvoiceFileName(input: { buyer: string; number: string; incoterm: string }) {
  const buyer = clean(input.buyer) || "Buyer";
  const number = clean(input.number) || "PREVIEW";
  const incoterm = clean(input.incoterm) || "Incoterm";
  return `Commercial Invoice - ${buyer} - ${number} - ${incoterm}.pdf`;
}

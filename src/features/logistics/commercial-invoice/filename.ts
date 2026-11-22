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

/** ASCII object key. The human name stays in Content-Disposition. */
export function commercialInvoiceObjectPath(id: string, number: string) {
  return `${id}/${number}.pdf`;
}

/** RFC 5987 download header. filename* keeps the human name, including non-ASCII. */
export function contentDisposition(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "").replace(/["\\]/g, "").replace(/\s+/g, " ").trim() || "commercial-invoice.pdf";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

import { cin7Get } from "../src/lib/cin7/transport";
import { readCin7AddressReport } from "../src/lib/cin7/read-sale";

const saleId = process.argv[2]?.trim() ?? "";
const accountId = process.env.CIN7_ACCOUNT_ID?.trim() ?? "";
const applicationKey = process.env.CIN7_APPLICATION_KEY?.trim() ?? "";

if (!saleId) {
  console.error("Usage: npx tsx scripts/check-cin7-address.ts <sale-id-or-order-number>");
  process.exit(1);
}
if (!accountId || !applicationKey) {
  console.error("Set CIN7_ACCOUNT_ID and CIN7_APPLICATION_KEY.");
  process.exit(1);
}

const report = await readCin7AddressReport(saleId, (path, query) => cin7Get({ accountId, applicationKey, path, query }));
if (!report) {
  console.error("Cin7 has no sale for that id.");
  process.exit(1);
}

const addressSource = report.addressSource === "sale"
  ? "sale shipping address"
  : report.addressSource === "default-shipping"
    ? "default shipping address"
    : "none";
const emailSource = report.emailSource === "named-contact"
  ? "named contact"
  : report.emailSource === "default-contact"
    ? "default contact"
    : report.emailSource;

console.log(`Address: ${report.address ?? "none"}`);
console.log(`Address source: ${addressSource}`);
console.log(`Postcode: ${report.postcode ?? "none"}`);
console.log(`Email: ${report.email ?? "none"}`);
console.log(`Email source: ${emailSource}`);

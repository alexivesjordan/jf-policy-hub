import { isCompanyEmail } from "@/lib/access";
import { splitPersonName } from "@/lib/names";
import { looksLikeUkPostcode, normaliseUkPostcode } from "@/lib/quotes/postcode";

export type AccessLetterInput = {
  contactName?: string | null;
  orderNumber?: string | null;
  postcode?: string | null;
  siteAddress?: string | null;
  repName?: string | null;
  repEmail?: string | null;
  url: string;
  reminder?: boolean;
};

const SALES_EMAIL = "sales@jordanfitness.co.uk";

export function accessFormSubject(reminder = false) {
  return reminder ? "Reminder: site access for your Jordan Fitness install" : "Site access for your Jordan Fitness install";
}

/** The access-form letter. A reminder uses the same letter, with one opening line. */
export function accessFormLetter(input: AccessLetterInput) {
  const firstName = splitPersonName(input.contactName).firstName;
  const orderNumber = clean(input.orderNumber);
  const postcode = installPostcode(input.postcode, input.siteAddress);
  const repName = clean(input.repName);
  const repEmail = clean(input.repEmail);
  const contactLine = repName && repEmail
    ? `If you have a question, contact ${repName} at ${repEmail}.`
    : repName
      ? `If you have a question, contact ${repName}.`
      : `If you have a question, contact Jordan Fitness at ${SALES_EMAIL}.`;
  const greeting = firstName ? `Hello ${firstName},` : "Hello,";
  const reminder = input.reminder
    ? "This is a reminder. We still need these details before the install."
    : "";
  const facts = [
    orderNumber ? `Order ${orderNumber}` : "",
    postcode ? `Install postcode ${postcode}` : "",
  ].filter(Boolean);

  const text = [
    greeting,
    "",
    ...(reminder ? [reminder, ""] : []),
    "Before your Jordan Fitness install, we need a few site access details and some photos or a short video. That lets us plan the route in, so the day goes smoothly.",
    "",
    "It takes a few minutes. Please include photos of the access route, from where the lorry can stop through to the room.",
    "",
    ...facts,
    ...(facts.length ? [""] : []),
    `Open the access form: ${input.url}`,
    "",
    contactLine,
    "",
    "Kind regards",
    repName || "Jordan Fitness",
    ...(repName ? ["Jordan Fitness"] : []),
  ].join("\n");

  const html = renderHtml({
    greeting,
    reminder,
    facts,
    url: input.url,
    contactLine,
    signOff: repName || "Jordan Fitness",
    showCompany: Boolean(repName),
  });

  return {
    subject: accessFormSubject(input.reminder === true),
    text,
    html,
    replyTo: repEmail && isCompanyEmail(repEmail) ? repEmail : null,
  };
}

function installPostcode(postcode: string | null | undefined, siteAddress: string | null | undefined) {
  const given = clean(postcode);
  if (given && looksLikeUkPostcode(given)) return normaliseUkPostcode(given);
  const found = clean(siteAddress)?.toUpperCase().match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/);
  return found ? normaliseUkPostcode(found[0]) : "";
}

function clean(value: string | null | undefined) {
  const text = value?.trim() ?? "";
  return text || "";
}

function renderHtml(input: { greeting: string; reminder: string; facts: string[]; url: string; contactLine: string; signOff: string; showCompany: boolean }) {
  const paragraphs = [
    input.reminder,
    "Before your Jordan Fitness install, we need a few site access details and some photos or a short video. That lets us plan the route in, so the day goes smoothly.",
    "It takes a few minutes. Please include photos of the access route, from where the lorry can stop through to the room.",
  ].filter(Boolean);
  const facts = input.facts.map((line) => `<p style="margin:0 0 4px;font-size:16px;line-height:1.5;color:#111111;">${escapeHtml(line)}</p>`).join("");
  return `<!DOCTYPE html>
<html lang="en-GB">
<body style="margin:0;padding:0;background:#f6f6f6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f6;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;">
          <tr>
            <td style="padding:28px 24px 8px;font-family:Segoe UI,Helvetica,Arial,sans-serif;">
              <p style="margin:0;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#525252;">Jordan Fitness</p>
              <h1 style="margin:8px 0 0;font-size:28px;line-height:1.2;font-weight:600;color:#111111;">Site access</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px 28px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#111111;">
              <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${escapeHtml(input.greeting)}</p>
              ${paragraphs.map((line) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${escapeHtml(line)}</p>`).join("")}
              ${facts}
              <a href="${escapeHtml(input.url)}" style="display:block;margin:20px 0;padding:14px 18px;background:#ce0037;color:#ffffff;text-align:center;text-decoration:none;border-radius:999px;font-size:16px;font-weight:600;">Open the access form</a>
              <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">${escapeHtml(input.contactLine)}</p>
              <p style="margin:0;font-size:16px;line-height:1.5;">Kind regards<br>${escapeHtml(input.signOff)}${input.showCompany ? "<br>Jordan Fitness" : ""}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

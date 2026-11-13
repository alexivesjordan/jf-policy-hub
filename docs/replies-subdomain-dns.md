# Replies subdomain DNS

Pulse sends each subcontractor quote from `pulse@jordanfitness.com` with its own reply address:

`q-<token>@replies.jordanfitness.com`

Replies must arrive at Resend, which then calls `POST /api/orbit/inbound-email`. Add the records below at Easyspace on the **subdomain only**. Do not change the MX records on `jordanfitness.com`. Those stay with the existing mail host. An MX on the root domain would take over the company inbox.

The MX target is shown in the Resend dashboard after you enable receiving. Copy that value. Depending on the region it is `receive.forge.rmta.net`, a regional name such as `receive-euw1.forge.rmta.net`, or `inbound-smtp.<region>.amazonaws.com`. The examples below use `<resend-mx>` for that value.

## 1. Add the domain in Resend

1. Resend → Domains → Add domain → `replies.jordanfitness.com`.
2. Copy every verification record Resend shows. For a domain created before August 2026 that is usually a DKIM TXT. For a newer domain Resend may show CNAMEs instead. Add those exact records.
3. Open the domain and turn on Receiving.
4. Copy the MX record Resend shows for receiving.
5. Webhooks → Add webhook.
   - Event: `email.received`
   - Endpoint: `https://pulse.jordanfitness.com/api/orbit/inbound-email`
   - Copy the signing secret into `RESEND_WEBHOOK_SECRET` on Vercel. Do not commit it.

Sending stays on `jordanfitness.com` (`pulse@jordanfitness.com`). The replies subdomain only receives.

## 2. Records at Easyspace

In the DNS control panel for `jordanfitness.com`, add records whose host is `replies`. Use the subdomain host the form asks for, not `@`.

| Type | Host | Value | Priority | Notes |
| --- | --- | --- | --- | --- |
| MX | `replies` | `<resend-mx>` copied from Resend | 10 | This must be the only MX for `replies`, or the lowest priority number. Mail for this subdomain then goes to Resend and nowhere else. |
| TXT | The host Resend shows, often `resend._domainkey.replies` | The DKIM value Resend shows | — | Required so Resend will verify the domain before it accepts inbound mail. |
| TXT or CNAME | Whatever else is on the domain’s Records tab | Copy each one exactly | — | SPF is not required for receiving only. Add it only when Resend lists it. |

After they are saved, click the confirmation in Resend and wait until the receiving MX shows verified.

## 3. What not to add

- No MX on `@` / `jordanfitness.com` for Resend.
- No second MX on `replies` pointing at Easyspace or Microsoft 365. Two MX records at the same priority split mail at random. A lower number than Resend’s would keep the mail away from Pulse.
- Do not forward mail straight at the MX hostname. Resend drops mail for a domain whose receiving MX is not verified.

## 4. Check

Send a message to `q-test@replies.jordanfitness.com` from outside Jordan Fitness. It should appear in Resend → Emails → Receiving, and Pulse should answer the webhook with HTTP 200. An unknown token is stored as unmatched and is not retried. A bad signature is rejected with HTTP 400.

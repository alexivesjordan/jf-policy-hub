# Commercial invoices

Office route: `/logistics/commercial-invoices`. The old `/sales/commercial-invoices` path redirects there.

Access is `logistics.can_use()`: an active admin or someone with operations view, and not a field engineer or installer. Sales access does not grant it.

Lookup and issue re-read the Cin7 sale on the server. Previews are watermarked and are not saved. Issued invoices are numbered `CI-YYYY-0001`, stored with the PDF, and cannot be edited. An admin can void one with a reason.

Seller details are fixed in server config: Jordan Fitness Ltd, both EORIs, VAT `GB385438070`, company number `12798165`.

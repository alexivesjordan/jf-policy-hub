export type PulseEmail = {
  to: string;
  subject: string;
  template: string;
  text: string;
  html: string;
  installId?: string | null;
  attachments?: { filename: string; contentBase64: string }[];
};

export type EmailLogRow = {
  to: string;
  subject: string;
  template: string;
  installId: string | null;
  providerId: string | null;
  status: "logged" | "sent" | "failed" | "redirected";
  detail: string | null;
};

export type EmailIo = {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  record: (row: EmailLogRow) => Promise<void>;
};

const FROM = "Jordan Pulse <pulse@jordanfitness.com>";

/** Sends through Resend, or only writes the log when the key or a preview override says so. */
export async function sendPulseEmail(input: PulseEmail, io: EmailIo) {
  const key = io.env.RESEND_API_KEY?.trim() ?? "";
  const redirect = io.env.EMAIL_REDIRECT_TO?.trim() ?? "";
  const base = {
    to: input.to,
    subject: input.subject,
    template: input.template,
    installId: input.installId ?? null,
  };

  if (!key) {
    await io.record({ ...base, providerId: null, status: "logged", detail: "RESEND_API_KEY is not set" });
    return { status: "logged" as const, providerId: null };
  }

  const deliveredTo = redirect || input.to;
  try {
    const response = await io.fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [deliveredTo],
        subject: input.subject,
        html: input.html,
        text: input.text,
        attachments: (input.attachments ?? []).map((file) => ({ filename: file.filename, content: file.contentBase64 })),
      }),
    });
    const body = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!response.ok) {
      await io.record({ ...base, providerId: null, status: "failed", detail: body?.message ?? `HTTP ${response.status}` });
      return { status: "failed" as const, providerId: null };
    }
    const status = redirect ? "redirected" : "sent";
    await io.record({
      ...base,
      providerId: body?.id ?? null,
      status,
      detail: redirect ? `Redirected to ${redirect}` : null,
    });
    return { status, providerId: body?.id ?? null };
  } catch (error) {
    await io.record({
      ...base,
      providerId: null,
      status: "failed",
      detail: error instanceof Error ? error.message : "Email send failed",
    });
    return { status: "failed" as const, providerId: null };
  }
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button, Input } from "@/components/pulse/ui";
import { confirmSignInCode, rememberThisDevice, sendSignInCode } from "@/features/account/two-step-actions";
import { createClient } from "@/lib/supabase/client";

export function TwoStepForm() {
  const [code, setCode] = useState("");
  const [factor, setFactor] = useState("");
  const [qr, setQr] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [emailReady, setEmailReady] = useState(false);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [emailPending, setEmailPending] = useState(false);

  return (
    <div className="max-w-md space-y-8">
      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          const supabase = createClient();
          if (!factor) {
            const enrolled = await supabase.auth.mfa.enroll({ factorType: "totp" });
            const image = enrolled.data?.totp?.qr_code ?? "";
            if (enrolled.error || !enrolled.data || !image) {
              toast.error("Could not start the authenticator app");
              return;
            }
            setFactor(enrolled.data.id);
            setQr(image);
            return;
          }
          const challenge = await supabase.auth.mfa.challenge({ factorId: factor });
          if (challenge.error || !challenge.data) {
            toast.error("Could not check that code");
            return;
          }
          const verified = await supabase.auth.mfa.verify({ factorId: factor, challengeId: challenge.data.id, code });
          if (verified.error) {
            toast.error("That code was not accepted");
            return;
          }
          await rememberThisDevice();
          toast.success("Authenticator app is on");
        }}
      >
        <h3 className="text-sm font-semibold">Authenticator app</h3>
        {qr ? <img src={qr} alt="Authenticator setup" className="size-40 rounded-xl bg-white p-2" /> : null}
        <label className="block text-sm font-semibold">
          Code
          <Input className="mt-1" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} aria-label="Authenticator code" />
        </label>
        <Button type="submit" className="min-h-11">{factor ? "Confirm" : "Set up"}</Button>
      </form>

      <form
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setEmailPending(true);
          setEmailMessage(null);
          if (!emailReady) {
            const sent = await sendSignInCode();
            setEmailPending(false);
            setEmailMessage(sent.message);
            if (sent.ok) setEmailReady(true);
            return;
          }
          const checked = await confirmSignInCode(emailCode);
          setEmailPending(false);
          setEmailMessage(checked.message);
        }}
      >
        <h3 className="text-sm font-semibold">Email a code</h3>
        <p className="text-sm text-grey">An email code does not open salaries or cases.</p>
        {emailMessage ? <p className="text-sm font-semibold">{emailMessage}</p> : null}
        {emailReady ? (
          <label className="block text-sm font-semibold">
            Code
            <Input className="mt-1" inputMode="numeric" autoComplete="one-time-code" value={emailCode} onChange={(event) => setEmailCode(event.target.value)} aria-label="Email code" />
          </label>
        ) : null}
        <Button type="submit" disabled={emailPending} className="min-h-11">
          {emailPending ? "Please wait..." : emailReady ? "Confirm" : "Email me a code"}
        </Button>
      </form>
    </div>
  );
}

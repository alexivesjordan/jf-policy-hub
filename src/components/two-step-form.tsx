"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button, Input } from "@/components/pulse/ui";
import { createClient } from "@/lib/supabase/client";

export function TwoStepForm() {
  const [code, setCode] = useState("");
  const [factor, setFactor] = useState("");
  return (
    <form
      className="max-w-md space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const supabase = createClient();
        if (!factor) {
          const enrolled = await supabase.auth.mfa.enroll({ factorType: "totp" });
          if (enrolled.error || !enrolled.data) {
            toast.error("Could not start two-step sign-in");
            return;
          }
          setFactor(enrolled.data.id);
          toast.success("Enter the code from your authenticator");
          return;
        }
        const challenge = await supabase.auth.mfa.challenge({ factorId: factor });
        if (challenge.error || !challenge.data) {
          toast.error("Could not check that code");
          return;
        }
        const verified = await supabase.auth.mfa.verify({ factorId: factor, challengeId: challenge.data.id, code });
        if (verified.error) toast.error("That code was not accepted");
        else toast.success("Two-step sign-in is on");
      }}
    >
      <label className="block text-sm font-semibold">
        Code
        <Input className="mt-1" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} aria-label="Code" />
      </label>
      <Button type="submit" className="min-h-11">{factor ? "Confirm" : "Set up"}</Button>
    </form>
  );
}

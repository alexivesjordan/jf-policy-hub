"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { passwordSetupPath, readAuthArrival } from "@/lib/auth-link";

// The email token can be used once. Strict mode runs effects twice, so the
// second call must not start another exchange.
let confirmStarted = false;

export function AuthConfirm() {
  const [message, setMessage] = useState("Checking your link...");

  useEffect(() => {
    if (confirmStarted) return;
    confirmStarted = true;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
      window.location.replace("/login");
      return;
    }

    const arrival = readAuthArrival(window.location.href);
    const supabase = createBrowserClient(supabaseUrl, supabaseKey, {
      isSingleton: false,
      auth: { detectSessionInUrl: false },
    });

    async function finish() {
      if (arrival.kind === "otp") {
        const { error } = await supabase.auth.verifyOtp({
          type: arrival.otpType as EmailOtpType,
          token_hash: arrival.tokenHash,
        });
        if (error) throw error;
        return;
      }

      if (arrival.kind === "pkce") {
        const { error } = await supabase.auth.exchangeCodeForSession(arrival.code);
        if (error) {
          const { data } = await supabase.auth.getSession();
          if (!data.session) throw error;
        }
        return;
      }

      if (arrival.kind === "session") {
        const { error } = await supabase.auth.setSession({
          access_token: arrival.accessToken,
          refresh_token: arrival.refreshToken,
        });
        if (error) throw error;
        return;
      }

      throw new Error("This link could not be used.");
    }

    finish()
      .then(() => {
        window.location.replace(passwordSetupPath());
      })
      .catch(() => {
        setMessage("That link could not be used.");
        window.location.replace("/login?error=link");
      });
  }, []);

  return <p className="text-grey">{message}</p>;
}

"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Banner, Button, Field, Input } from "@/components/ui";

type Mode = "link" | "password" | "signup";

export function LinkError() {
  const params = useSearchParams();
  if (params.get("error") !== "link") return null;
  return (
    <p className="rounded-2xl bg-rose/10 px-4 py-3 text-sm text-rose">
      That email link is invalid or has expired. Request a new one.
    </p>
  );
}

function nextPathFromLocation() {
  const next = new URLSearchParams(window.location.search).get("next") ?? "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("link");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const fullName = String(form.get("fullName") ?? "").trim();
    const supabase = createClient();
    const nextPath = nextPathFromLocation();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;

    if (mode === "link") {
      const { error: linkError } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });
      setPending(false);
      if (linkError) {
        setError("We could not send that email. Check the address and try again.");
        return;
      }
      setMessage("Check your email for a sign-in link.");
      return;
    }

    if (mode === "signup") {
      if (password.length < 8) {
        setPending(false);
        setError("Use a password of at least 8 characters.");
        return;
      }
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName }, emailRedirectTo: redirectTo },
      });
      setPending(false);
      if (signUpError) {
        setError(signUpError.message);
        return;
      }
      if (data.session) {
        router.push(nextPath);
        router.refresh();
        return;
      }
      setMessage("Check your email to confirm the account, then come back and sign in.");
      return;
    }

    const { error: passwordError } = await supabase.auth.signInWithPassword({ email, password });
    setPending(false);
    if (passwordError) {
      setError("Those details were not recognised. Try again, or use an email link.");
      return;
    }
    router.push(nextPath);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2 rounded-full bg-paper p-1">
        {(
          [
            ["link", "Email link"],
            ["password", "Password"],
            ["signup", "Create account"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setMode(value);
              setError(null);
              setMessage(null);
            }}
            className={`min-h-10 rounded-full px-2 text-sm font-semibold ${mode === value ? "bg-white text-pine shadow-sm" : "text-ink/70"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {message ? <Banner tone="success">{message}</Banner> : null}
        {mode === "signup" ? (
          <Field label="Your name">
            <Input name="fullName" autoComplete="name" required />
          </Field>
        ) : null}
        <Field label="Email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        {mode !== "link" ? (
          <Field label="Password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
            <Input name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required />
          </Field>
        ) : null}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Please wait..." : mode === "link" ? "Email me a link" : mode === "signup" ? "Create account" : "Sign in"}
        </Button>
      </form>

      {mode === "signup" ? (
        <p className="text-sm leading-6 text-ink/70">
          The first account for alex.ives@jordanfitness.com becomes the administrator. Everyone else starts as staff until an administrator changes their role.
        </p>
      ) : (
        <p className="text-sm leading-6 text-ink/70">
          Use the email address you were invited with. An email link is the simplest way in.
        </p>
      )}
    </div>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Banner, Button, Field, Input } from "@/components/ui";
import { safeNextPath } from "@/lib/access";

export function LinkError() {
  const params = useSearchParams();
  if (params.get("error") !== "link") return null;
  return (
    <p className="rounded-2xl border border-red bg-card px-4 py-3 text-sm text-white">
      That link is invalid or has expired. Request a new password email.
    </p>
  );
}

export function LoginForm() {
  const router = useRouter();
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
    const nextPath = safeNextPath(new URLSearchParams(window.location.search).get("next"));
    const supabase = createClient();
    const { error: passwordError } = await supabase.auth.signInWithPassword({ email, password });
    setPending(false);
    if (passwordError) {
      setError("Those details were not recognised. Try again, or use Forgot password if you have not set one yet.");
      return;
    }
    setMessage("Signed in.");
    router.push(nextPath);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? <Banner tone="error">{error}</Banner> : null}
      {message ? <Banner tone="success">{message}</Banner> : null}
      <Field label="Email">
        <Input name="email" type="email" autoComplete="username" required />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Please wait..." : "Sign in"}
      </Button>
      <p className="text-sm leading-6 text-grey">
        <Link href="/login/forgot" className="font-semibold text-white underline decoration-red underline-offset-4">
          Forgot password?
        </Link>{" "}
        Use this if you have not chosen a password yet. Invites and sign-in are limited to @jordanfitness.com.
      </p>
    </form>
  );
}

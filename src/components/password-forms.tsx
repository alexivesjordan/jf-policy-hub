"use client";

import { useActionState } from "react";
import Link from "next/link";
import { changePassword, requestPasswordReset } from "@/features/auth/actions";
import { Banner, Button, Field, Input } from "@/components/ui";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, null);

  return (
    <form action={action} className="space-y-4">
      {state ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
      <Field label="Email" hint="The address an administrator invited, or the one you already sign in with.">
        <Input name="email" type="email" autoComplete="username" required />
      </Field>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Sending..." : "Email me a link"}
      </Button>
      <p className="text-sm leading-6 text-grey">
        <Link href="/login" className="font-semibold text-ink underline decoration-red underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

export function SetPasswordForm({ next, setup }: { next: string; setup: boolean }) {
  const [state, action, pending] = useActionState(changePassword, null);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {state?.ok === false ? <Banner tone="error">{state.message}</Banner> : null}
      <Field label="New password" hint="At least 8 characters.">
        <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Confirm password">
        <Input name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : setup ? "Save password and continue" : "Change password"}
      </Button>
    </form>
  );
}

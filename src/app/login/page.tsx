import { Suspense } from "react";
import { LinkError, LoginForm } from "@/components/login-form";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="bg-pine px-6 py-10 text-white lg:px-12 lg:py-16">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-white/70">Jordan Fitness</p>
        <h1 className="font-display mt-4 max-w-md text-5xl leading-tight">Policy Hub</h1>
        <p className="mt-4 max-w-md text-lg leading-8 text-white/85">
          The place to keep company policies, see what changed, and review suggested updates. Made for HR and managers.
        </p>
      </section>
      <section className="flex items-center px-6 py-10 lg:px-12">
        <div className="mx-auto w-full max-w-md space-y-6">
          <div>
            <h2 className="font-display text-3xl">Sign in</h2>
            <p className="mt-2 text-ink/70">Use an email link or your password.</p>
          </div>
          {isSupabaseConfigured() ? (
            <>
              <Suspense fallback={null}>
                <LinkError />
              </Suspense>
              <LoginForm />
            </>
          ) : (
            <p className="leading-7 text-ink/80">
              This app is not connected to Supabase yet. Add the keys in .env.local and restart.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

import { Suspense } from "react";
import { LinkError, LoginForm } from "@/components/login-form";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
      <section className="pulse-grid relative px-6 py-10 text-ink lg:px-12 lg:py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-grey">Jordan Fitness</p>
        <h1 className="font-display mt-6 max-w-lg text-5xl font-semibold tracking-wide text-ink md:text-6xl">JORDAN PULSE</h1>
        <p className="mt-4 max-w-md text-lg leading-8 text-grey">AI operations and automation platform</p>
        <p className="mt-8 max-w-md text-sm leading-6 text-grey">
          Pulse People is open for HR and compliance. The install office is open for Operations. The other modules are on the way.
        </p>
      </section>
      <section className="flex items-center bg-paper px-6 py-10 lg:px-12">
        <div className="mx-auto w-full max-w-md space-y-6">
          <div>
            <h2 className="font-display text-3xl text-ink">Sign in</h2>
            <p className="mt-2 text-grey">Use your Jordan Fitness email and password.</p>
          </div>
          {isSupabaseConfigured() ? (
            <>
              <Suspense fallback={null}>
                <LinkError />
              </Suspense>
              <LoginForm />
            </>
          ) : (
            <p className="leading-7 text-ink/75">
              This app is not connected to Supabase yet. Add the keys in .env.local and restart.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

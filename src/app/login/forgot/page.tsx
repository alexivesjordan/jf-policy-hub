import { ForgotPasswordForm } from "@/components/password-forms";
import { isSupabaseConfigured } from "@/lib/env";

export const metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
      <section className="orbit-grid relative px-6 py-10 text-white lg:px-12 lg:py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-grey">Jordan Fitness</p>
        <h1 className="font-display mt-6 max-w-lg text-5xl font-semibold tracking-wide text-white md:text-6xl">JORDAN ORBIT</h1>
        <p className="mt-4 max-w-md text-lg leading-8 text-grey">AI operations and automation platform</p>
      </section>
      <section className="flex items-center bg-paper px-6 py-10 lg:px-12">
        <div className="mx-auto w-full max-w-md space-y-6">
          <div>
            <h2 className="font-display text-3xl text-white">Forgot password</h2>
            <p className="mt-2 text-grey">
              We will email a link to choose a password. Use this if you have never set one, or if you need a new one.
            </p>
          </div>
          {isSupabaseConfigured() ? (
            <ForgotPasswordForm />
          ) : (
            <p className="leading-7 text-white/75">This app is not connected to Supabase yet.</p>
          )}
        </div>
      </section>
    </main>
  );
}

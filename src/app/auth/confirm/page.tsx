import { AuthConfirm } from "@/components/auth-confirm";

export const metadata = { title: "Signing in" };

export default function ConfirmPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <p className="text-sm font-semibold uppercase tracking-wide text-grey">Jordan Pulse</p>
      <h1 className="font-display mt-2 text-4xl">Signing you in</h1>
      <div className="mt-4">
        <AuthConfirm />
      </div>
    </main>
  );
}

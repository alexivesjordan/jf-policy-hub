import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <p className="text-sm font-semibold uppercase tracking-wide text-yellow">Jordan Orbit</p>
      <h1 className="font-display mt-2 text-4xl">We could not find that page</h1>
      <p className="mt-3 text-white/70">The link may be out of date. Head back to the modules.</p>
      <Link href="/" className="mt-6 font-semibold text-yellow underline">
        All modules
      </Link>
    </main>
  );
}

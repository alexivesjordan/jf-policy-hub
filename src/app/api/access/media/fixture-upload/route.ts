export async function PUT() {
  if (process.env.VERCEL_ENV === "production") {
    return new Response(null, { status: 404 });
  }
  return new Response(null, { status: 200 });
}

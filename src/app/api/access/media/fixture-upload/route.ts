export async function PUT() {
  if (process.env.ACCESS_FIXTURE_UPLOAD !== "1") {
    return new Response(null, { status: 404 });
  }
  return new Response(null, { status: 200 });
}

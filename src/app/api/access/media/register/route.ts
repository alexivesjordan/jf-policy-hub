import { NextResponse } from "next/server";
import { finishAccessMediaUpload } from "@/features/operations/access-actions";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { token?: string; path?: string };
    const result = await finishAccessMediaUpload(String(body.token ?? ""), String(body.path ?? ""));
    if (!result.ok) return NextResponse.json({ message: result.message }, { status: 400 });
    return NextResponse.json({ fileId: result.fileId });
  } catch {
    return NextResponse.json({ message: "Could not store that file." }, { status: 400 });
  }
}

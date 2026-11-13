import { NextResponse } from "next/server";
import { prepareAccessMediaUpload } from "@/features/operations/access-actions";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { token?: string; mime?: string; byteSize?: number };
    const result = await prepareAccessMediaUpload(String(body.token ?? ""), String(body.mime ?? ""), Number(body.byteSize ?? 0));
    if (!result.ok || !result.signedUrl || !result.path) {
      return NextResponse.json({ message: result.ok ? "Could not start that upload." : result.message }, { status: 400 });
    }
    return NextResponse.json({ signedUrl: result.signedUrl, path: result.path, token: result.token });
  } catch {
    return NextResponse.json({ message: "Could not start that upload." }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { env } from "cloudflare:workers";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  if (!env.DB) return NextResponse.json({ status: "degraded", db: "unbound" }, { status: 503, headers });
  try {
    await env.DB.prepare("SELECT 1").first();
    return NextResponse.json({ status: "ok", db: "ok" }, { headers });
  } catch {
    return NextResponse.json({ status: "degraded", db: "error" }, { status: 503, headers });
  }
}

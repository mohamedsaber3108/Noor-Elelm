import { NextResponse } from "next/server";
import { env } from "cloudflare:workers";
import { getPublicSettings } from "@/lib/settings";

/** Public: only site.* and feature.* keys. No auth. Short cache. Defaults are returned when the database is unavailable. */
export async function GET() {
  return NextResponse.json({ settings: await getPublicSettings(env.DB) }, { headers: { "Cache-Control": "public, max-age=30" } });
}

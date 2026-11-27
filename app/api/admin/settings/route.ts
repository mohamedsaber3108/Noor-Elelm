import { NextRequest, NextResponse } from "next/server";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { clientIp, getCurrentUser, isAdmin, sameOrigin } from "@/app/auth";
import { AUDIT_UNAVAILABLE } from "@/lib/audit";
import { getAllSettings, getModules, setSetting } from "@/lib/settings";

const err = (error: string, status: number) => NextResponse.json({ error }, { status });
const NO_STORE = { "Cache-Control": "no-store" };

/** GET -> every setting (value, default, who changed it and when) and the module registry. Admin with verified MFA. */
export async function GET() {
  const admin = await getCurrentUser();
  if (!isAdmin(admin)) return err("ADMIN_ACCESS_REQUIRED", 403);
  const db = env.DB;
  if (!db) return err("DATABASE_UNAVAILABLE", 503);
  return NextResponse.json({ settings: await getAllSettings(db), modules: await getModules(db) }, { headers: NO_STORE });
}

const putSchema = z.object({ key: z.string().min(1).max(80), value: z.unknown(), reason: z.string().trim().min(10).max(300) });

/** PUT {key, value, reason} changes one setting. The change and its audit row are one batch. */
export async function PUT(req: NextRequest) {
  if (!sameOrigin(req)) return err("BAD_ORIGIN", 403);
  const admin = await getCurrentUser();
  if (!admin || !isAdmin(admin)) return err("ADMIN_ACCESS_REQUIRED", 403);
  const db = env.DB;
  if (!db) return err("DATABASE_UNAVAILABLE", 503);
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err("INVALID_INPUT", 400);
  const r = await setSetting(db, admin, parsed.data.key, parsed.data.value, parsed.data.reason, clientIp(req));
  if (r === "UNKNOWN_KEY") return err("UNKNOWN_KEY", 400);
  if (r === "INVALID_VALUE") return err("INVALID_VALUE", 400);
  if (r === AUDIT_UNAVAILABLE) return err(AUDIT_UNAVAILABLE, 503);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}

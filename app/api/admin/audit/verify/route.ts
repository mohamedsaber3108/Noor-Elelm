import { NextResponse } from "next/server";
import { env } from "cloudflare:workers";
import { getCurrentUser, isAdmin } from "@/app/auth";
import { verifyAuditChain } from "@/lib/audit";
import { auditAdminDenied } from "@/lib/audit-denied";

const NO_STORE = { "Cache-Control": "no-store" };

/** GET: read-only check of the audit hash chain. Admin with a verified MFA session only. Changes nothing. */
export async function GET(req?: Request) {
  const u = await getCurrentUser();
  if (!isAdmin(u)) {
    await auditAdminDenied(req, "/api/admin/audit/verify");
    return NextResponse.json({ error: "ADMIN_ACCESS_REQUIRED" }, { status: 403, headers: NO_STORE });
  }
  if (!env.DB) return NextResponse.json({ error: "DATABASE_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
  return NextResponse.json(await verifyAuditChain(env.DB), { headers: NO_STORE });
}

import { cookies } from "next/headers";
import { env } from "cloudflare:workers";

export type AppUser = { userId: string; email: string; displayName: string; fullName: string | null; role: string; mfaVerified: boolean };

export const SESSION_COOKIE = "nai_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 100_000; // Workers WebCrypto maximum
const enc = new TextEncoder();

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256);
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64(salt)}$${b64(await derive(password, salt, PBKDF2_ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !salt || !hash) return false;
  const actual = new Uint8Array(await derive(password, unb64(salt), Number(iter)));
  const expected = unb64(hash);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

const sha256Hex = async (v: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(v)));

export function sessionCookieOptions(secure: boolean, maxAgeSeconds = SESSION_TTL_MS / 1000) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", maxAge: maxAgeSeconds };
}

/** Creates a session row and returns the raw token to be placed in the cookie. */
export async function createSession(userId: string, userAgent: string | null, opts: { mfaVerified?: boolean } = {}) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await env.DB!.prepare("INSERT INTO sessions(id,user_id,expires_at,user_agent,mfa_verified_at) VALUES(?,?,?,?,?)")
    .bind(await sha256Hex(token), userId, Date.now() + SESSION_TTL_MS, userAgent?.slice(0, 200) ?? null, opts.mfaVerified ? Date.now() : null).run();
  return token;
}

export async function destroySession(token: string) {
  await env.DB!.prepare("DELETE FROM sessions WHERE id=?").bind(await sha256Hex(token)).run();
}

/** Id of the current session row (hash of the cookie token), or null. */
export async function currentSessionId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token && token.length <= 128 ? sha256Hex(token) : null;
}

/**
 * The signed-in user. Staff (reviewer, admin, REVIEWER_IDS) whose session is not MFA-verified count as signed out,
 * so every route refuses them. Only the MFA routes and the session probe pass `allowUnverified`.
 */
export async function getCurrentUser(opts: { allowUnverified?: boolean } = {}): Promise<AppUser | null> {
  if (!env.DB) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 128) return null;
  const row = await env.DB.prepare(
    "SELECT u.id,u.email,u.display_name,u.role,s.mfa_verified_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?",
  ).bind(await sha256Hex(token), Date.now()).first<{ id: string; email: string; display_name: string; role: string; mfa_verified_at: number | null }>();
  if (!row) return null;
  const user: AppUser = { userId: row.id, email: row.email, displayName: row.display_name, fullName: row.display_name, role: row.role, mfaVerified: row.mfa_verified_at != null };
  if (isStaff(user) && !user.mfaVerified && !opts.allowUnverified) return null;
  return user;
}

/** Staff by role or by REVIEWER_IDS. Staff need an MFA-verified session (OD-04a). */
export function isStaff(user: { userId: string; role: string } | null | undefined): boolean {
  if (!user) return false;
  if (user.role === "reviewer" || user.role === "admin") return true;
  const ids = String((env as unknown as Record<string, unknown>).REVIEWER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return ids.includes(user.userId);
}

/** Reviewer access: DB role `reviewer`/`admin`, or user id listed in REVIEWER_IDS. Email allowlists are intentionally unsupported (emails are unverified). */
export function isReviewer(user: AppUser | null | undefined): boolean {
  return !!user && isStaff(user) && user.mfaVerified;
}

export function isAdmin(user: AppUser | null | undefined): boolean {
  return !!user && user.role === "admin" && user.mfaVerified;
}

/** Fixed-window limiter backed by D1. Returns true when the call is allowed. */
export async function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const row = await env.DB!.prepare(
    "INSERT INTO rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET " +
      "count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END, reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END RETURNING count",
  ).bind(key, now + windowMs, now, now, now + windowMs).first<{ count: number }>();
  return (row?.count ?? 1) <= limit;
}

export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value.startsWith("/login") || value.startsWith("/register")) return "/";
  return value;
}

/** Is this request https? True if the URL says so or the first X-Forwarded-Proto value does ("https, http" counts as https). */
export function isHttps(req: Request): boolean {
  return new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https";
}

/** CSRF guard: a browser Origin must match the host this request was addressed to (directly or via our reverse proxy). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) {
    // No Origin: trust the browser's Sec-Fetch-Site hint when it is there.
    const site = req.headers.get("sec-fetch-site");
    if (site) return site === "same-origin" || site === "none";
    // No hints at all: only a client without a session cookie (scripts, curl) may go on.
    return !new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=`).test(req.headers.get("cookie") || "");
  }
  let o: URL;
  try { o = new URL(origin); } catch { return false; } // "null" lands here
  const scheme = isHttps(req) ? "https:" : "http:";
  if (o.protocol !== scheme) return false;
  const hosts = [new URL(req.url).host, req.headers.get("host"), req.headers.get("x-forwarded-host")?.split(",")[0].trim()];
  return hosts.some((h) => !!h && h === o.host);
}

/**
 * Client IP for rate limiting. On Cloudflare the edge sets CF-Connecting-IP.
 * Behind our own reverse proxy (EC2/nginx) set TRUST_PROXY_HEADER=x-real-ip: nginx overwrites that
 * header with the real peer address, and the app port is bound to localhost so it cannot be spoofed.
 */
export function clientIp(req: Request): string {
  const trusted = String((env as unknown as Record<string, unknown>).TRUST_PROXY_HEADER || "").toLowerCase();
  if (trusted) {
    const v = req.headers.get(trusted)?.split(",")[0].trim();
    if (v) return v;
  }
  return req.headers.get("cf-connecting-ip") || "unknown";
}

export type RegistrationMode = "closed" | "allowlist" | "open";

/** Sign-up policy from REGISTRATION_MODE. Anything unset or unknown is `closed` (OD-04c). */
export function registrationMode(): RegistrationMode {
  const v = String((env as unknown as Record<string, unknown>).REGISTRATION_MODE || "").trim().toLowerCase();
  return v === "open" || v === "allowlist" ? v : "closed";
}

// Limits of `allowlist` (review PR #2, findings 1-2): a stranger can test whether an address is listed
// (403 vs other answers), and email is not verified, so the first person to register a listed address owns it.
// Keep `closed` until email verification exists (OD-04b). Behaviour is unchanged on purpose.
/** True when the current mode lets this email register. REGISTRATION_ALLOWLIST is a comma list of emails. */
export function registrationAllowed(email: string): boolean {
  const mode = registrationMode();
  if (mode === "open") return true;
  if (mode !== "allowlist") return false;
  const list = String((env as unknown as Record<string, unknown>).REGISTRATION_ALLOWLIST || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

import { env } from "cloudflare:workers";
import { sendMail } from "@/lib/mail";

export type TokenKind = "reset" | "verify";
export const TOKEN_TTL_MS: Record<TokenKind, number> = { reset: 30 * 60 * 1000, verify: 24 * 60 * 60 * 1000 };

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
export const hashToken = async (token: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(token)));

/** 32 random bytes as URL-safe base64 (43 characters). */
export function newToken() {
  let s = "";
  for (const b of crypto.getRandomValues(new Uint8Array(32))) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Statements that retire older tokens of the same kind and store the hash of a new one. Returns the raw token for the mail only. */
export async function createToken(userId: string, kind: TokenKind) {
  const token = newToken(), now = Date.now();
  await env.DB!.batch([
    env.DB!.prepare("UPDATE auth_tokens SET used_at=? WHERE user_id=? AND kind=? AND used_at IS NULL").bind(now, userId, kind),
    env.DB!.prepare("INSERT INTO auth_tokens(id,user_id,kind,token_hash,expires_at) VALUES(?,?,?,?,?)")
      .bind(crypto.randomUUID(), userId, kind, await hashToken(token), now + TOKEN_TTL_MS[kind]),
  ]);
  return { token, expiresAt: now + TOKEN_TTL_MS[kind] };
}

/** Single-use check in one atomic UPDATE: two requests with the same token cannot both succeed. Returns the user id. */
export async function consumeToken(token: string, kind: TokenKind): Promise<string | null> {
  if (!token || token.length > 128) return null;
  const row = await env.DB!.prepare(
    "UPDATE auth_tokens SET used_at=? WHERE token_hash=? AND kind=? AND used_at IS NULL AND expires_at>? RETURNING user_id",
  ).bind(Date.now(), await hashToken(token), kind, Date.now()).first<{ user_id: string }>();
  return row?.user_id ?? null;
}

/** Link base from MAIL_LINK_BASE only. It is never taken from request headers (host header poisoning). */
export function linkBase(): string | null {
  const v = String((env as unknown as Record<string, unknown>).MAIL_LINK_BASE || "").trim().replace(/\/+$/, "");
  return /^https?:\/\/[^\s/]+$/.test(v) ? v : null;
}

const RLM = "\u200F";

/** Bilingual plain-text mail. The link sits on its own line; Arabic lines start with a right-to-left mark. */
export function mailBody(kind: TokenKind, link: string, expiresAt: number) {
  const until = new Date(expiresAt).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const reset = kind === "reset", mins = TOKEN_TTL_MS[kind] / 60000;
  const arWhen = reset ? "30 دقيقة" : "24 ساعة", enWhen = reset ? `${mins} minutes` : "24 hours";
  const subject = reset ? "إعادة تعيين كلمة المرور / Reset your password" : "تأكيد البريد الإلكتروني / Confirm your email";
  const text = [
    RLM + (reset ? "طلبت إعادة تعيين كلمة المرور لحسابك في نور العلم." : "أكّد بريدك الإلكتروني لحسابك في نور العلم."),
    RLM + `الرابط صالح لمدة ${arWhen} (حتى ${until}) ويعمل مرة واحدة:`,
    "", link, "",
    RLM + (reset ? "إن لم تطلب ذلك فتجاهل هذه الرسالة، ولن يتغير شيء." : "إن لم تنشئ هذا الحساب فتجاهل هذه الرسالة."),
    "", "-----", "",
    reset ? "You asked to reset the password of your Noor al-Ilm account." : "Please confirm the email of your Noor al-Ilm account.",
    `The link is valid for ${enWhen} (until ${until}) and works once:`,
    "", link, "",
    reset ? "If you did not ask for this, ignore this message. Nothing will change." : "If you did not create this account, ignore this message.",
  ].join("\n");
  return { subject, text };
}

/**
 * Same database and hashing work as `issueMail`, for an address that has no account, so the answer takes about as long.
 * shortcut: a real mail provider call adds time for known users only; send it after the response (waitUntil) when one is chosen.
 */
export async function decoyMail(kind: TokenKind) {
  try {
    const now = Date.now(), hash = await hashToken(newToken());
    await env.DB!.batch([
      env.DB!.prepare("UPDATE auth_tokens SET used_at=? WHERE user_id=? AND kind=? AND used_at IS NULL").bind(now, "", kind),
      env.DB!.prepare("UPDATE auth_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL").bind(now, hash),
    ]);
    mailBody(kind, "", now);
  } catch { /* nothing to report */ }
}

/**
 * Creates a token and mails the link. Never throws and never returns the token: callers answer the same way
 * whatever happens here. Only an error code is logged, never a token, link or address.
 */
export async function issueMail(user: { id: string; email: string }, kind: TokenKind) {
  try {
    const base = linkBase();
    if (!base) { console.warn("auth mail skipped: MAIL_LINK_BASE_MISSING"); return; }
    const { token, expiresAt } = await createToken(user.id, kind);
    const link = `${base}/${kind === "reset" ? "reset" : "verify-email"}#t=${token}`;
    const r = await sendMail({ to: user.email, ...mailBody(kind, link, expiresAt) });
    if (!r.ok) console.warn("auth mail failed:", r.error);
  } catch {
    console.warn("auth mail failed: INTERNAL");
  }
}

import { env } from "cloudflare:workers";
import { timingSafeEqual } from "@/lib/totp";

// Secrets at rest: AES-GCM with a key derived from the env setting MFA_SECRET_KEY (name only; the value lives in the server's secret store).
export class MfaNotConfigured extends Error { constructor() { super("MFA_NOT_CONFIGURED"); } }

const enc = new TextEncoder();
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const MIN_KEY_CHARS = 32;

/** Throws MfaNotConfigured (fail closed) when the key is missing or too short. */
async function aesKey() {
  const raw = String((env as unknown as Record<string, unknown>).MFA_SECRET_KEY || "");
  if (raw.length < MIN_KEY_CHARS) throw new MfaNotConfigured();
  return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode(raw)), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export const mfaConfigured = () => String((env as unknown as Record<string, unknown>).MFA_SECRET_KEY || "").length >= MIN_KEY_CHARS;

/** `v1$iv$ciphertext`. The user id is bound in as additional data, so a row copied to another user does not decrypt. */
export async function encryptSecret(secret: Uint8Array, userId: string): Promise<string> {
  const key = await aesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(userId) }, key, secret as BufferSource));
  return `v1$${b64(iv)}$${b64(ct)}`;
}

export async function decryptSecret(stored: string, userId: string): Promise<Uint8Array> {
  const key = await aesKey();
  const [v, iv, ct] = stored.split("$");
  if (v !== "v1" || !iv || !ct) throw new Error("BAD_SECRET_FORMAT");
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: enc.encode(userId) }, key, unb64(ct)));
}

// Recovery codes: 10 characters from an alphabet without look-alikes, shown as xxxxx-xxxxx.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const RECOVERY_COUNT = 10;

export function newRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  const s = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

export const normalizeRecovery = (v: string) => v.toUpperCase().replace(/[\s-]/g, "");

/** `salt$sha256(salt:code)` with a fresh salt per code. */
export async function hashRecovery(code: string, salt = b64(crypto.getRandomValues(new Uint8Array(16)))) {
  return `${salt}$${hex(await crypto.subtle.digest("SHA-256", enc.encode(`${salt}:${normalizeRecovery(code)}`)))}`;
}

export async function matchesRecovery(code: string, stored: string) {
  const [salt] = stored.split("$");
  return !!salt && timingSafeEqual(await hashRecovery(code, salt), stored);
}

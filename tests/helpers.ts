import { NextRequest } from "next/server";
import { env } from "cloudflare:workers";
import { SESSION_COOKIE, createSession, hashPassword } from "@/app/auth";
import { setCookie } from "./mocks/next-headers";

export const PASSWORD = "correct-horse-battery";
let hashed: Promise<string> | undefined;

type Role = "learner" | "researcher" | "fact_checker" | "language_editor" | "scholar" | "publisher" | "reviewer" | "admin";
export const db = () => env.DB as unknown as import("./d1").D1Stub;
export const setEnv = (key: string, value: unknown) => void ((env as unknown as Record<string, unknown>)[key] = value);

/** Inserts a user (password PASSWORD) and returns its id. */
export async function seedUser(role: Role, email = `${role}-${crypto.randomUUID().slice(0, 8)}@example.test`) {
  const id = crypto.randomUUID();
  hashed ??= hashPassword(PASSWORD);
  await db().prepare("INSERT INTO users(id,email,display_name,password_hash,role) VALUES(?,?,?,?,?)")
    .bind(id, email, `User ${role}`, await hashed, role).run();
  return { id, email };
}

/** Creates a user with a session and makes the mocked cookie jar send that session. Staff sessions are MFA-verified. */
export async function signIn(role: Role) {
  const u = await seedUser(role);
  setCookie(SESSION_COOKIE, await createSession(u.id, "vitest", { mfaVerified: role !== "learner" }));
  return u;
}

/** Like signIn, but the session has not passed MFA (what staff have right after the password step). */
export async function signInUnverified(role: Role) {
  const u = await seedUser(role);
  const token = await createSession(u.id, "vitest");
  setCookie(SESSION_COOKIE, token);
  return { ...u, token };
}

/** Marks every session of a user as MFA-verified (for tests that make a learner staff through REVIEWER_IDS). */
export const verifySessions = (userId: string) =>
  db().prepare("UPDATE sessions SET mfa_verified_at=? WHERE user_id=?").bind(Date.now(), userId).run();

/** Calls route.ts handler with a JSON request. Pass origin to simulate a browser. */
export function call(method: string, path: string, body?: unknown, opts: { origin?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.origin) headers.origin = opts.origin;
  // A request that carries a cookie is a browser request: it must send same-origin hints (see origin-rule.test.ts).
  else if (headers.cookie && !headers["sec-fetch-site"]) headers["sec-fetch-site"] = "same-origin";
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

export const EVIL = { origin: "https://evil.example" };

export async function count(sql: string, ...args: unknown[]) {
  return (await db().prepare(sql).bind(...args).first<{ n: number }>())!.n;
}

export const authCtx = (action: string) => ({ params: Promise.resolve({ action }) });

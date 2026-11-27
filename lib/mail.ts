import { env } from "cloudflare:workers";

export type Mail = { to: string; subject: string; text: string };
export type MailResult = { ok: true; sent: boolean } | { ok: false; error: "MAIL_PROVIDER_NOT_IMPLEMENTED" | "MAIL_OUTBOX_TEST_ONLY" };

// Test-only sink. Production code never registers one, so `MAIL_PROVIDER=outbox` cannot store a message
// (and so cannot store a reset link) outside tests (OD-04b).
let sink: Mail[] | null = null;
export function setTestOutbox(list: Mail[] | null) { sink = list; }

const envStr = (key: string) => String((env as unknown as Record<string, unknown>)[key] || "").trim();

/** Sender name only. The address behind it belongs to the provider that the owner picks (QUESTIONS Q7). */
export const mailFrom = () => envStr("MAIL_FROM");

/**
 * Mail sender. `MAIL_PROVIDER` unset or `none`: nothing is sent and nothing is logged.
 * A named provider is not built yet (Q7) and answers with an error code, never with a message text.
 * shortcut: one stub, no queue or retry; replace the final branch with the chosen provider's call.
 */
export async function sendMail(mail: Mail): Promise<MailResult> {
  const provider = envStr("MAIL_PROVIDER").toLowerCase();
  if (!provider || provider === "none") return { ok: true, sent: false };
  if (provider === "outbox") {
    if (!sink) return { ok: false, error: "MAIL_OUTBOX_TEST_ONLY" };
    sink.push(mail);
    return { ok: true, sent: true };
  }
  return { ok: false, error: "MAIL_PROVIDER_NOT_IMPLEMENTED" };
}

/**
 * Admin settings and module registry (N-17).
 * A fixed registry of known keys: no free keys. Each key has a zod schema and a default. Values are stored as JSON
 * strings in the `settings` table (migration 0009). Reads are tolerant: a missing table, a missing row or a corrupt
 * value gives the default, so a settings fault can never take the site down. Text values are plain text: the UI
 * renders them as text nodes only, and tags are refused on write.
 * These keys hold no secrets. Do not add a secret key here.
 */
import { z } from "zod";
import { AUDIT_UNAVAILABLE, auditStatement, runAudited } from "@/lib/audit";

// Plain text, 1 to 500 chars, no tags and no control characters (newline and tab allowed).
const plain = z.string().trim().min(1).max(500)
  .refine((s) => !/[<>]/.test(s), "NO_TAGS")
  .refine((s) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s), "NO_CONTROL");

export const PRICING_NOTE_AR = "الخطط المدفوعة غير معروضة حاليًا. المعرفة الأساسية متاحة مجانًا حاليًا، ولا يوجد بيع أو دفع الآن.";
export const PRICING_NOTE_EN = "Not available yet. Basic knowledge is free for now.";
export const REGISTRATION_NOTE_AR = "التسجيل مغلق مؤقتًا. يمكن لأصحاب الحسابات الحالية تسجيل الدخول.";
export const REGISTRATION_NOTE_EN = "Registration is temporarily closed. Existing account holders can still sign in.";

export const SETTINGS = {
  "feature.game_enabled": { schema: z.boolean(), default: true as boolean | string },
  "feature.corrections_enabled": { schema: z.boolean(), default: true as boolean | string },
  "site.pricing_note_ar": { schema: plain, default: PRICING_NOTE_AR as boolean | string },
  "site.pricing_note_en": { schema: plain, default: PRICING_NOTE_EN as boolean | string },
  "site.registration_note_ar": { schema: plain, default: REGISTRATION_NOTE_AR as boolean | string },
  "site.registration_note_en": { schema: plain, default: REGISTRATION_NOTE_EN as boolean | string },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue = boolean | string;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
export const isSettingKey = (k: unknown): k is SettingKey => typeof k === "string" && Object.hasOwn(SETTINGS, k);
const isPublicKey = (k: string) => k.startsWith("site.") || k.startsWith("feature.");

type Row = { key: string; value: string; updated_at: number | null; updated_by: string | null };

function parse(key: SettingKey, raw: string | undefined): SettingValue {
  if (raw === undefined) return SETTINGS[key].default;
  try {
    const r = SETTINGS[key].schema.safeParse(JSON.parse(raw));
    return r.success ? (r.data as SettingValue) : SETTINGS[key].default;
  } catch {
    return SETTINGS[key].default;
  }
}

async function rows(db: D1Database | undefined): Promise<Row[]> {
  if (!db) return [];
  try {
    return (await db.prepare("SELECT key,value,updated_at,updated_by FROM settings").all<Row>()).results;
  } catch {
    return []; // table missing (migration 0009 not applied yet): defaults apply
  }
}

export async function getSetting<K extends SettingKey>(db: D1Database | undefined, key: K): Promise<SettingValue> {
  const all = await rows(db);
  return parse(key, all.find((r) => r.key === key)?.value);
}

/** Every key with its current value, default and last change (admin view). */
export async function getAllSettings(db: D1Database | undefined) {
  const all = await rows(db);
  return SETTING_KEYS.map((key) => {
    const r = all.find((x) => x.key === key);
    return { key, value: parse(key, r?.value), default: SETTINGS[key].default, updatedAt: r?.updated_at ?? null, updatedBy: r?.updated_by ?? null };
  });
}

/** Only site.* and feature.* keys, as a plain object. */
export async function getPublicSettings(db: D1Database | undefined): Promise<Record<string, SettingValue>> {
  const all = await rows(db);
  return Object.fromEntries(SETTING_KEYS.filter(isPublicKey).map((k) => [k, parse(k, all.find((r) => r.key === k)?.value)]));
}

export const featureOn = async (db: D1Database | undefined, key: "feature.game_enabled" | "feature.corrections_enabled") => (await getSetting(db, key)) !== false;

export type SetResult = "ok" | "UNKNOWN_KEY" | "INVALID_VALUE" | typeof AUDIT_UNAVAILABLE;

const clip = (v: SettingValue) => JSON.stringify(v).slice(0, 500);

/** Validates, then writes the value and its SETTING_CHANGED audit row in one batch. A failed audit leaves the value unchanged. */
export async function setSetting(
  db: D1Database, actor: { userId: string; role: string }, key: unknown, value: unknown, reason: string, source: string,
): Promise<SetResult> {
  if (!isSettingKey(key)) return "UNKNOWN_KEY";
  const parsed = SETTINGS[key].schema.safeParse(value);
  if (!parsed.success) return "INVALID_VALUE";
  const before = await getSetting(db, key);
  const after = parsed.data as SettingValue;
  const done = await runAudited(db, async () => [
    db.prepare("INSERT INTO settings(key,value,updated_at,updated_by) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at,updated_by=excluded.updated_by")
      .bind(key, JSON.stringify(after), Date.now(), actor.userId),
    // The audit helper refuses a detail key named "key", so the setting name goes under "setting".
    await auditStatement(db, { actorId: actor.userId, actorRole: actor.role, action: "SETTING_CHANGED", targetId: key, detail: { setting: key, before: clip(before), after: clip(after) }, source, reason }),
  ]);
  return done ? "ok" : AUDIT_UNAVAILABLE;
}

/**
 * Module registry (FOUNDATION s.8). A module is listed only when its backend answers a cheap read.
 * State comes from flags: on, off or preview. No module is in preview today; the type keeps the contract.
 */
export type ModuleState = "on" | "off" | "preview";
type Module = { id: string; nameAr: string; nameEn: string; path: string; roles: ("reviewer" | "admin")[]; probe: string; flag?: "feature.corrections_enabled" };
const MODULES: Module[] = [
  { id: "users", nameAr: "المستخدمون", nameEn: "Users", path: "/admin/users", roles: ["admin"], probe: "SELECT 1 FROM users LIMIT 1" },
  { id: "editorial", nameAr: "استيراد المحتوى والمراجعة", nameEn: "Editorial import and review", path: "/admin", roles: ["reviewer", "admin"], probe: "SELECT 1 FROM content_items LIMIT 1" },
  { id: "infographics", nameAr: "طابور الإنفوجرافيك", nameEn: "Infographics queue", path: "/admin/infographics", roles: ["reviewer", "admin"], probe: "SELECT 1 FROM reviews LIMIT 1" },
  { id: "corrections", nameAr: "بلاغات التصحيح", nameEn: "Corrections inbox", path: "/admin/corrections", roles: ["reviewer", "admin"], probe: "SELECT 1 FROM audit_events LIMIT 1", flag: "feature.corrections_enabled" },
  { id: "audit", nameAr: "التحقق من سجل التدقيق", nameEn: "Audit verification", path: "/admin/settings", roles: ["admin"], probe: "SELECT 1 FROM audit_events LIMIT 1" },
  { id: "settings", nameAr: "الإعدادات", nameEn: "Settings", path: "/admin/settings", roles: ["admin"], probe: "SELECT 1 FROM settings LIMIT 1" },
];

export async function getModules(db: D1Database | undefined) {
  const out = [];
  for (const m of MODULES) {
    let healthy = false;
    try { if (db) { await db.prepare(m.probe).first(); healthy = true; } } catch { healthy = false; }
    if (!healthy) continue; // shown only if its backend works
    const state: ModuleState = m.flag && !(await featureOn(db, m.flag)) ? "off" : "on";
    out.push({ id: m.id, nameAr: m.nameAr, nameEn: m.nameEn, path: m.path, roles: m.roles, healthy, state });
  }
  return out;
}

import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, primaryKey, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const sourceFiles = sqliteTable("source_files", {
  id: text("id").primaryKey(), path: text("path").notNull(), sha256: text("sha256").notNull(),
  kind: text("kind").notNull(), status: text("status").notNull().default("IMPORTED"), createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});
export const contentItems = sqliteTable("content_items", {
  id: text("id").primaryKey(), world: text("world").notNull(), slug: text("slug").notNull(),
  title: text("title").notNull(), body: text("body").notNull().default(""), status: text("status").notNull().default("IMPORTED"),
  sourceFileId: text("source_file_id"), sourceLocator: text("source_locator"), revision: integer("revision").notNull().default(1),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`)
},t=>[uniqueIndex("content_slug").on(t.slug),index("content_world").on(t.world)]);
export const contentRevisions = sqliteTable("content_revisions", {id:text("id").primaryKey(),contentId:text("content_id").notNull(),revision:integer("revision").notNull(),title:text("title").notNull(),body:text("body").notNull(),status:text("status").notNull(),actorId:text("actor_id").notNull(),createdAt:text("created_at").default(sql`CURRENT_TIMESTAMP`)},t=>[index("revision_content").on(t.contentId,t.revision)]);
export const citations = sqliteTable("citations", {id:text("id").primaryKey(),contentId:text("content_id").notNull(),sourceName:text("source_name").notNull(),locator:text("locator"),url:text("url"),license:text("license"),verifiedAt:text("verified_at")});
export const translations = sqliteTable("translations", {contentId:text("content_id").notNull(),locale:text("locale").notNull(),title:text("title").notNull(),body:text("body").notNull(),status:text("status").notNull().default("PENDING_TRANSLATION_REVIEW"),translator:text("translator"),reviewer:text("reviewer")},t=>[primaryKey({columns:[t.contentId,t.locale]})]);
export const reviews = sqliteTable("reviews", {id:text("id").primaryKey(),contentId:text("content_id").notNull(),reviewerId:text("reviewer_id").notNull(),role:text("role").notNull(),decision:text("decision").notNull(),note:text("note").notNull().default(""),createdAt:text("created_at").default(sql`CURRENT_TIMESTAMP`)});
export const quizQuestions = sqliteTable("quiz_questions", {id:text("id").primaryKey(),locale:text("locale").notNull().default("ar"),question:text("question").notNull(),type:text("type").notNull(),optionsJson:text("options_json").notNull(),correctKey:text("correct_key").notNull(),hint:text("hint").notNull().default(""),explanation:text("explanation").notNull().default(""),sourceUrl:text("source_url").notNull(),level:text("level").notNull(),status:text("status").notNull().default("DRAFT"),reviewedBy:text("reviewed_by"),createdAt:text("created_at").default(sql`CURRENT_TIMESTAMP`)});
export const quizAttempts = sqliteTable("quiz_attempts", {id:text("id").primaryKey(),userId:text("user_id").notNull(),questionId:text("question_id").notNull(),answerKey:text("answer_key").notNull(),correct:integer("correct").notNull(),createdAt:text("created_at").default(sql`CURRENT_TIMESTAMP`)},t=>[index("attempt_user_question").on(t.userId,t.questionId),index("attempt_user_time").on(t.userId,t.createdAt)]);
export const quizServed = sqliteTable("quiz_served",{token:text("token").primaryKey(),userId:text("user_id").notNull(),questionId:text("question_id").notNull(),expiresAt:text("expires_at").notNull(),consumedAt:text("consumed_at"),createdAt:text("created_at").default(sql`CURRENT_TIMESTAMP`)},t=>[index("served_user_time").on(t.userId,t.createdAt)]);
export const pointLedger = sqliteTable("point_ledger", {id:text("id").primaryKey(),userId:text("user_id").notNull(),questionId:text("question_id").notNull(),kind:text("kind").notNull().default("FIRST_CORRECT"),delta:integer("delta").notNull(),attemptId:text("attempt_id").notNull(),createdAt:text("created_at").default(sql`CURRENT_TIMESTAMP`)},t=>[uniqueIndex("coin_once_per_question").on(t.userId,t.questionId,t.kind)]);
export const progress = sqliteTable("progress", {userId:text("user_id").notNull(),lessonId:text("lesson_id").notNull(),completedAt:text("completed_at").default(sql`CURRENT_TIMESTAMP`)},t=>[primaryKey({columns:[t.userId,t.lessonId]})]);
export const bookmarks = sqliteTable("bookmarks",{userId:text("user_id").notNull(),contentId:text("content_id").notNull(),createdAt:text("created_at").default(sql`CURRENT_TIMESTAMP`)},t=>[primaryKey({columns:[t.userId,t.contentId]})]);
export const partners = sqliteTable("partners",{id:text("id").primaryKey(),name:text("name").notNull(),status:text("status").notNull().default("PENDING_CONSENT"),agreementRef:text("agreement_ref")});
export const rewards = sqliteTable("rewards",{id:text("id").primaryKey(),partnerId:text("partner_id").notNull(),title:text("title").notNull(),cost:integer("cost").notNull(),status:text("status").notNull().default("DISABLED")});
export const redemptions = sqliteTable("redemptions",{id:text("id").primaryKey(),userId:text("user_id").notNull(),rewardId:text("reward_id").notNull(),status:text("status").notNull(),createdAt:text("created_at").default(sql`CURRENT_TIMESTAMP`)});
export const auditEvents = sqliteTable("audit_events",{id:text("id").primaryKey(),actorId:text("actor_id").notNull(),action:text("action").notNull(),targetId:text("target_id").notNull(),detailJson:text("detail_json").notNull().default("{}"),createdAt:text("created_at").default(sql`CURRENT_TIMESTAMP`),seq:integer("seq"),prevHash:text("prev_hash"),hash:text("hash"),actorRole:text("actor_role"),result:text("result"),source:text("source"),reason:text("reason")},t=>[index("audit_action_time").on(t.action,t.createdAt),index("audit_actor_action").on(t.actorId,t.action),uniqueIndex("audit_seq_unique").on(t.seq),uniqueIndex("audit_prev_hash_unique").on(t.prevHash)]);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), email: text("email").notNull(), displayName: text("display_name").notNull(),
  passwordHash: text("password_hash").notNull(), role: text("role").notNull().default("learner"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`), lastLoginAt: text("last_login_at"), emailVerifiedAt: integer("email_verified_at")
}, t => [uniqueIndex("users_email_unique").on(t.email)]);
// Single-use reset and verify tokens. Only the SHA-256 of the token is stored (OD-04b).
export const authTokens = sqliteTable("auth_tokens", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), kind: text("kind", { enum: ["reset", "verify"] }).notNull(),
  tokenHash: text("token_hash").notNull(), expiresAt: integer("expires_at").notNull(), usedAt: integer("used_at"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`)
}, t => [index("auth_tokens_hash_idx").on(t.tokenHash), index("auth_tokens_user_kind_idx").on(t.userId, t.kind)]);
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), expiresAt: integer("expires_at").notNull(),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`), userAgent: text("user_agent"), mfaVerifiedAt: integer("mfa_verified_at"), lastSeenAt: integer("last_seen_at")
}, t => [index("sessions_user_idx").on(t.userId), index("sessions_expiry_idx").on(t.expiresAt)]);
export const userMfa = sqliteTable("user_mfa", {
  userId: text("user_id").primaryKey(), secretEnc: text("secret_enc").notNull(), enabledAt: integer("enabled_at"), lastStep: integer("last_step")
});
export const mfaRecoveryCodes = sqliteTable("mfa_recovery_codes", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), codeHash: text("code_hash").notNull(), usedAt: integer("used_at")
}, t => [index("mfa_recovery_user_idx").on(t.userId)]);
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(), count: integer("count").notNull().default(0), resetAt: integer("reset_at").notNull()
});

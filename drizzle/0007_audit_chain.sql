ALTER TABLE `audit_events` ADD `seq` integer;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `prev_hash` text;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `hash` text;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `actor_role` text;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `result` text;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `source` text;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `reason` text;--> statement-breakpoint
CREATE UNIQUE INDEX `audit_seq_unique` ON `audit_events` (`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `audit_prev_hash_unique` ON `audit_events` (`prev_hash`);--> statement-breakpoint
-- Hand-written below (drizzle-kit snapshots cover tables and columns only, not triggers).
-- Append-only: any UPDATE or DELETE on audit_events aborts. Old rows stay valid and readable.
CREATE TRIGGER `audit_events_no_update` BEFORE UPDATE ON `audit_events`
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_APPEND_ONLY');
END;--> statement-breakpoint
CREATE TRIGGER `audit_events_no_delete` BEFORE DELETE ON `audit_events`
BEGIN
  SELECT RAISE(ABORT, 'AUDIT_APPEND_ONLY');
END;

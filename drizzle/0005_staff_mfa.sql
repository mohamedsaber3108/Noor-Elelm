CREATE TABLE `mfa_recovery_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE INDEX `mfa_recovery_user_idx` ON `mfa_recovery_codes` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_mfa` (
	`user_id` text PRIMARY KEY NOT NULL,
	`secret_enc` text NOT NULL,
	`enabled_at` integer,
	`last_step` integer
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `mfa_verified_at` integer;
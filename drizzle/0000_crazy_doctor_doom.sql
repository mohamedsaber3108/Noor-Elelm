CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`target_id` text NOT NULL,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `bookmarks` (
	`user_id` text NOT NULL,
	`content_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY(`user_id`, `content_id`)
);
--> statement-breakpoint
CREATE TABLE `citations` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`source_name` text NOT NULL,
	`locator` text,
	`url` text,
	`license` text,
	`verified_at` text
);
--> statement-breakpoint
CREATE TABLE `content_items` (
	`id` text PRIMARY KEY NOT NULL,
	`world` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'IMPORTED' NOT NULL,
	`source_file_id` text,
	`source_locator` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_slug` ON `content_items` (`slug`);--> statement-breakpoint
CREATE INDEX `content_world` ON `content_items` (`world`);--> statement-breakpoint
CREATE TABLE `partners` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'PENDING_CONSENT' NOT NULL,
	`agreement_ref` text
);
--> statement-breakpoint
CREATE TABLE `point_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`question_id` text NOT NULL,
	`kind` text DEFAULT 'FIRST_CORRECT' NOT NULL,
	`delta` integer NOT NULL,
	`attempt_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coin_once_per_question` ON `point_ledger` (`user_id`,`question_id`,`kind`);--> statement-breakpoint
CREATE TABLE `progress` (
	`user_id` text NOT NULL,
	`lesson_id` text NOT NULL,
	`completed_at` text DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY(`user_id`, `lesson_id`)
);
--> statement-breakpoint
CREATE TABLE `quiz_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`question_id` text NOT NULL,
	`answer_key` text NOT NULL,
	`correct` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `attempt_user_question` ON `quiz_attempts` (`user_id`,`question_id`);--> statement-breakpoint
CREATE TABLE `quiz_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`locale` text DEFAULT 'ar' NOT NULL,
	`question` text NOT NULL,
	`type` text NOT NULL,
	`options_json` text NOT NULL,
	`correct_key` text NOT NULL,
	`hint` text DEFAULT '' NOT NULL,
	`explanation` text DEFAULT '' NOT NULL,
	`source_url` text NOT NULL,
	`level` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`reviewed_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`reward_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`reviewer_id` text NOT NULL,
	`role` text NOT NULL,
	`decision` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `rewards` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`title` text NOT NULL,
	`cost` integer NOT NULL,
	`status` text DEFAULT 'DISABLED' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_files` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`sha256` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'IMPORTED' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `translations` (
	`content_id` text NOT NULL,
	`locale` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'PENDING_TRANSLATION_REVIEW' NOT NULL,
	`translator` text,
	`reviewer` text,
	PRIMARY KEY(`content_id`, `locale`)
);

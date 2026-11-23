CREATE TABLE `content_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`revision` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX `revision_content` ON `content_revisions` (`content_id`,`revision`);
CREATE TABLE `admin_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`target_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_requests_status_idx` ON `admin_requests` (`status`,`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `admin_requests_one_pending` ON `admin_requests` (`target_id`) WHERE status = 'PENDING';
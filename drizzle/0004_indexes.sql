CREATE INDEX `audit_action_time` ON `audit_events` (`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_actor_action` ON `audit_events` (`actor_id`,`action`);--> statement-breakpoint
CREATE INDEX `attempt_user_time` ON `quiz_attempts` (`user_id`,`created_at`);
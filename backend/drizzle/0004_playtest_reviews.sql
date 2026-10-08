CREATE TABLE `playtest_reviews` (
	`session_id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`started_at` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`state` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `playtest_reviews_project_date` ON `playtest_reviews` (`project_id`,`started_at`);
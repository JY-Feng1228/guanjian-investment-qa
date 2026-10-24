CREATE TABLE `qa_records` (
	`sandbox` text NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`sandbox`, `id`)
);
--> statement-breakpoint
CREATE INDEX `qa_sandbox_kind` ON `qa_records` (`sandbox`,`kind`);
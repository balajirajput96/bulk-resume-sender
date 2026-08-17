ALTER TABLE `campaigns` ADD `scheduleCronTaskUid` varchar(65);--> statement-breakpoint
ALTER TABLE `campaigns` ADD COLUMN `scheduleCronTaskUid` varchar(65);--> statement-breakpoint
ALTER TABLE `campaigns` ADD CONSTRAINT `campaigns_scheduleCronTaskUid_unique` UNIQUE(`scheduleCronTaskUid`);

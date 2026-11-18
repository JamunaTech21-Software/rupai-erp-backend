-- RP1-201 N.9 In-app notifications: document expiry reminders and escalations, and who has read them.
-- CreateTable
CREATE TABLE `notifications` (
    `id` CHAR(26) NOT NULL,
    `kind` VARCHAR(30) NOT NULL,
    `resource` VARCHAR(40) NOT NULL,
    `record_id` CHAR(26) NOT NULL,
    `dedupe_key` VARCHAR(120) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `message` VARCHAR(500) NOT NULL,
    `level` VARCHAR(10) NOT NULL,
    `due_date` DATE NULL,
    `stage_days` INTEGER NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `notifications_dedupe_key_key`(`dedupe_key`),
    INDEX `notifications_resolved_at_created_at_idx`(`resolved_at`, `created_at`),
    INDEX `notifications_resource_record_id_idx`(`resource`, `record_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notification_reads` (
    `notification_id` CHAR(26) NOT NULL,
    `user_id` CHAR(26) NOT NULL,
    `read_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notification_reads_user_id_idx`(`user_id`),
    PRIMARY KEY (`notification_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `notification_reads` ADD CONSTRAINT `notification_reads_notification_id_fkey` FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


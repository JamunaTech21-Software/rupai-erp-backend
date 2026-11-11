-- CreateTable
CREATE TABLE `document_settings` (
    `id` CHAR(26) NOT NULL,
    `enable_expiry_tracking` BOOLEAN NOT NULL,
    `enable_renewal_reminder` BOOLEAN NOT NULL,
    `default_reminder_days` INTEGER NOT NULL,
    `escalation_days` INTEGER NOT NULL,
    `reminders` JSON NOT NULL,
    `email_enabled` BOOLEAN NOT NULL,
    `in_app_enabled` BOOLEAN NOT NULL,
    `sms_enabled` BOOLEAN NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

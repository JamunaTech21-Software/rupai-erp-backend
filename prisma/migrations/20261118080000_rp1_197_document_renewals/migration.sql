-- RP1-197 N.7 Document Renewal: renewal history (old and new dates, authority, reminders, files).
-- CreateTable
CREATE TABLE `document_renewals` (
    `id` CHAR(26) NOT NULL,
    `document_id` CHAR(26) NOT NULL,
    `old_issue_date` DATE NOT NULL,
    `old_expiry_date` DATE NULL,
    `new_issue_date` DATE NOT NULL,
    `new_expiry_date` DATE NOT NULL,
    `old_issuing_authority` VARCHAR(200) NULL,
    `issuing_authority` VARCHAR(200) NULL,
    `old_reminder_setting` VARCHAR(10) NOT NULL,
    `old_reminder_days` JSON NULL,
    `reminder_setting` VARCHAR(10) NOT NULL,
    `reminder_days` JSON NULL,
    `old_attachment` CHAR(26) NULL,
    `new_attachment` CHAR(26) NULL,
    `approval_id` CHAR(26) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `document_renewals_document_id_created_at_idx`(`document_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `document_renewals` ADD CONSTRAINT `document_renewals_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


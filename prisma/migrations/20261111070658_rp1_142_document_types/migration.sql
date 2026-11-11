-- CreateTable
CREATE TABLE `document_types` (
    `id` CHAR(26) NOT NULL,
    `category_id` CHAR(26) NOT NULL,
    `type_code` VARCHAR(20) NOT NULL,
    `type_name` VARCHAR(150) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(20) NOT NULL,
    `display_order` INTEGER NOT NULL,
    `renewal_required` BOOLEAN NOT NULL DEFAULT true,
    `default_reminder_days` INTEGER NOT NULL DEFAULT 30,
    `escalation_days` INTEGER NOT NULL DEFAULT 7,
    `auto_status_update` BOOLEAN NOT NULL DEFAULT true,
    `renewal_validity` VARCHAR(10) NOT NULL DEFAULT 'SAME',
    `renewal_validity_months` INTEGER NULL,
    `allow_version_upload` BOOLEAN NOT NULL DEFAULT true,
    `keep_previous_versions` BOOLEAN NOT NULL DEFAULT true,
    `notify_responsible` BOOLEAN NOT NULL DEFAULT true,
    `reminders` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `document_types_type_code_idx`(`type_code`),
    INDEX `document_types_category_id_type_name_idx`(`category_id`, `type_name`),
    INDEX `document_types_deleted_at_display_order_idx`(`deleted_at`, `display_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `document_types` ADD CONSTRAINT `document_types_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `document_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

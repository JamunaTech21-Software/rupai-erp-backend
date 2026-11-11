-- CreateTable
CREATE TABLE `documents` (
    `id` CHAR(26) NOT NULL,
    `category_id` CHAR(26) NOT NULL,
    `type_id` CHAR(26) NOT NULL,
    `document_name` VARCHAR(200) NOT NULL,
    `document_no` VARCHAR(60) NOT NULL,
    `issuing_authority` VARCHAR(200) NULL,
    `issue_date` DATE NOT NULL,
    `expiry_date` DATE NULL,
    `validity_months` INTEGER NULL,
    `renewal_required` BOOLEAN NOT NULL,
    `reminder_setting` VARCHAR(10) NOT NULL,
    `reminder_days` JSON NULL,
    `attachment` CHAR(26) NULL,
    `remarks` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `documents_document_no_idx`(`document_no`),
    INDEX `documents_category_id_idx`(`category_id`),
    INDEX `documents_type_id_idx`(`type_id`),
    INDEX `documents_deleted_at_expiry_date_idx`(`deleted_at`, `expiry_date`),
    INDEX `documents_deleted_at_created_at_idx`(`deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `documents_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `document_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `documents` ADD CONSTRAINT `documents_type_id_fkey` FOREIGN KEY (`type_id`) REFERENCES `document_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

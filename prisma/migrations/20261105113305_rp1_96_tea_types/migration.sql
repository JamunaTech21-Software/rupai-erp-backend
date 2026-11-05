-- CreateTable
CREATE TABLE `tea_types` (
    `id` CHAR(26) NOT NULL,
    `tea_type_code` VARCHAR(50) NOT NULL,
    `tea_type_name` VARCHAR(100) NOT NULL,
    `short_name` VARCHAR(50) NULL,
    `processing_method` VARCHAR(60) NOT NULL,
    `description` TEXT NULL,
    `applicable_for` JSON NOT NULL,
    `status` VARCHAR(60) NOT NULL,
    `remarks` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `tea_types_tea_type_code_idx`(`tea_type_code`),
    INDEX `tea_types_deleted_at_created_at_idx`(`deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

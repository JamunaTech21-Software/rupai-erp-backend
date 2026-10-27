-- CreateTable
CREATE TABLE `divisions` (
    `id` CHAR(26) NOT NULL,
    `estate_id` CHAR(26) NOT NULL,
    `division_name` VARCHAR(255) NOT NULL,
    `division_code` VARCHAR(60) NOT NULL,
    `total_area` DECIMAL(12, 2) NOT NULL,
    `total_section` INTEGER NULL,
    `status` VARCHAR(20) NOT NULL,
    `description` VARCHAR(250) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `divisions_estate_id_division_code_idx`(`estate_id`, `division_code`),
    INDEX `divisions_deleted_at_created_at_idx`(`deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sections` (
    `id` CHAR(26) NOT NULL,
    `division_id` CHAR(26) NOT NULL,
    `parent_section_id` CHAR(26) NULL,
    `section_name` VARCHAR(255) NOT NULL,
    `section_code` VARCHAR(60) NOT NULL,
    `total_area` DECIMAL(12, 2) NOT NULL,
    `manager` VARCHAR(255) NULL,
    `status` VARCHAR(20) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `sections_division_id_section_code_idx`(`division_id`, `section_code`),
    INDEX `sections_parent_section_id_idx`(`parent_section_id`),
    INDEX `sections_deleted_at_created_at_idx`(`deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `divisions` ADD CONSTRAINT `divisions_estate_id_fkey` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sections` ADD CONSTRAINT `sections_division_id_fkey` FOREIGN KEY (`division_id`) REFERENCES `divisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sections` ADD CONSTRAINT `sections_parent_section_id_fkey` FOREIGN KEY (`parent_section_id`) REFERENCES `sections`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

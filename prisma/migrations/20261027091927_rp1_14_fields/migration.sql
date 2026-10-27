-- CreateTable
CREATE TABLE `fields` (
    `id` CHAR(26) NOT NULL,
    `estate_id` CHAR(26) NOT NULL,
    `division_id` CHAR(26) NOT NULL,
    `section_id` CHAR(26) NOT NULL,
    `field_name` VARCHAR(255) NOT NULL,
    `field_code` VARCHAR(60) NOT NULL,
    `field_type` VARCHAR(40) NOT NULL,
    `parent_field_id` CHAR(26) NULL,
    `total_area` DECIMAL(12, 2) NOT NULL,
    `planted_area` DECIMAL(12, 2) NOT NULL,
    `planting_year` INTEGER NOT NULL,
    `bush_type` VARCHAR(40) NOT NULL,
    `spacing` VARCHAR(60) NOT NULL,
    `altitude` DECIMAL(10, 2) NULL,
    `average_slope` DECIMAL(5, 2) NULL,
    `irrigation` VARCHAR(40) NULL,
    `soil_type` VARCHAR(40) NULL,
    `drainage` VARCHAR(40) NULL,
    `status` VARCHAR(40) NOT NULL,
    `description` TEXT NULL,
    `polygon` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `fields_estate_id_field_code_idx`(`estate_id`, `field_code`),
    INDEX `fields_division_id_idx`(`division_id`),
    INDEX `fields_section_id_idx`(`section_id`),
    INDEX `fields_parent_field_id_idx`(`parent_field_id`),
    INDEX `fields_deleted_at_created_at_idx`(`deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `fields` ADD CONSTRAINT `fields_estate_id_fkey` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fields` ADD CONSTRAINT `fields_division_id_fkey` FOREIGN KEY (`division_id`) REFERENCES `divisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fields` ADD CONSTRAINT `fields_section_id_fkey` FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fields` ADD CONSTRAINT `fields_parent_field_id_fkey` FOREIGN KEY (`parent_field_id`) REFERENCES `fields`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

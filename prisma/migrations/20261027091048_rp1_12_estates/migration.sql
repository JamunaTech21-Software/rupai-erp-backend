-- CreateTable
CREATE TABLE `estates` (
    `id` CHAR(26) NOT NULL,
    `estate_name` VARCHAR(255) NOT NULL,
    `estate_code` VARCHAR(255) NOT NULL,
    `established_year` INTEGER NULL,
    `company_owner` VARCHAR(255) NULL,
    `estate_type` VARCHAR(60) NOT NULL,
    `estate_category` VARCHAR(60) NOT NULL,
    `address` TEXT NULL,
    `police_station` VARCHAR(255) NULL,
    `district` VARCHAR(255) NULL,
    `division` VARCHAR(255) NULL,
    `country` VARCHAR(255) NULL,
    `zip_code` VARCHAR(255) NULL,
    `phone` VARCHAR(20) NULL,
    `email` VARCHAR(160) NULL,
    `website` VARCHAR(255) NULL,
    `total_land_area` DECIMAL(12, 2) NOT NULL,
    `tea_area` DECIMAL(12, 2) NOT NULL,
    `non_tea_area` DECIMAL(12, 2) NULL,
    `total_field_block` INTEGER NULL,
    `total_division` INTEGER NULL,
    `total_section` INTEGER NULL,
    `total_worker` INTEGER NULL,
    `total_family` INTEGER NULL,
    `selected_facilities` JSON NOT NULL,
    `other_facility_name` VARCHAR(255) NULL,
    `estate_images` JSON NOT NULL,
    `latitude` DECIMAL(10, 7) NOT NULL,
    `longitude` DECIMAL(10, 7) NOT NULL,
    `description` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `estates_estate_code_idx`(`estate_code`),
    INDEX `estates_deleted_at_created_at_idx`(`deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `estate_managers` (
    `id` CHAR(26) NOT NULL,
    `estate_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL,
    `type` VARCHAR(40) NOT NULL,
    `name` VARCHAR(255) NULL,
    `mobile` VARCHAR(20) NULL,
    `email` VARCHAR(160) NULL,

    INDEX `estate_managers_estate_id_position_idx`(`estate_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `estate_managers` ADD CONSTRAINT `estate_managers_estate_id_fkey` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

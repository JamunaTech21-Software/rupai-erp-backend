-- CreateTable
CREATE TABLE `replanting_master` (
    `id` CHAR(26) NOT NULL,
    `project_code` VARCHAR(20) NOT NULL,
    `project_name` VARCHAR(255) NOT NULL,
    `estate_id` CHAR(26) NOT NULL,
    `division_id` CHAR(26) NOT NULL,
    `section_id` CHAR(26) NOT NULL,
    `field_id` CHAR(26) NOT NULL,
    `replant_type` VARCHAR(60) NOT NULL,
    `season` VARCHAR(60) NULL,
    `survey_date` DATE NOT NULL,
    `target_date` DATE NULL,
    `supervisor` VARCHAR(255) NULL,
    `remarks` TEXT NULL,
    `gap_survey_date` DATE NULL,
    `survey_by` VARCHAR(255) NULL,
    `plant_variety` VARCHAR(60) NULL,
    `planning_date` DATE NULL,
    `store` VARCHAR(100) NULL,
    `prepared_by` VARCHAR(255) NULL,
    `material_remarks` TEXT NULL,
    `labour_source` VARCHAR(60) NULL,
    `wage_type` VARCHAR(60) NULL,
    `planting_date` DATE NULL,
    `clone_variety` VARCHAR(60) NULL,
    `till_date` DATE NULL,
    `completion_date` DATE NULL,
    `survival_90_days` DECIMAL(5, 2) NULL,
    `completion_remarks` TEXT NULL,
    `last_step` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    UNIQUE INDEX `replanting_master_project_code_key`(`project_code`),
    INDEX `replanting_master_estate_id_idx`(`estate_id`),
    INDEX `replanting_master_deleted_at_created_at_idx`(`deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `replanting_gap_details` (
    `id` CHAR(26) NOT NULL,
    `replanting_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL,
    `gap_id` VARCHAR(60) NOT NULL,
    `gap_size` DECIMAL(10, 2) NOT NULL,
    `no_of_plants` INTEGER NOT NULL,
    `gap_type` VARCHAR(40) NOT NULL,
    `location` VARCHAR(255) NULL,
    `status` VARCHAR(40) NULL,

    INDEX `replanting_gap_details_replanting_id_position_idx`(`replanting_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `replanting_land_preparation` (
    `id` CHAR(26) NOT NULL,
    `replanting_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL,
    `activity` VARCHAR(100) NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `status` VARCHAR(40) NOT NULL,

    INDEX `replanting_land_preparation_replanting_id_position_idx`(`replanting_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `replanting_material` (
    `id` CHAR(26) NOT NULL,
    `replanting_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL,
    `material_name` VARCHAR(100) NOT NULL,
    `unit` VARCHAR(20) NOT NULL,
    `required_qty` DECIMAL(12, 2) NOT NULL,
    `unit_cost` DECIMAL(12, 2) NOT NULL,
    `total_cost` DECIMAL(14, 2) NOT NULL,

    INDEX `replanting_material_replanting_id_position_idx`(`replanting_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `replanting_labour` (
    `id` CHAR(26) NOT NULL,
    `replanting_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL,
    `labour_type` VARCHAR(60) NOT NULL,
    `male_qty` INTEGER NOT NULL,
    `female_qty` INTEGER NOT NULL,
    `rate` DECIMAL(10, 2) NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,

    INDEX `replanting_labour_replanting_id_position_idx`(`replanting_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `replanting_planting_rows` (
    `id` CHAR(26) NOT NULL,
    `replanting_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL,
    `row_no` INTEGER NOT NULL,
    `from_plant` INTEGER NOT NULL,
    `to_plant` INTEGER NOT NULL,
    `plants` INTEGER NOT NULL,
    `planted_by` VARCHAR(100) NULL,

    INDEX `replanting_planting_rows_replanting_id_position_idx`(`replanting_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `replanting_progress` (
    `id` CHAR(26) NOT NULL,
    `replanting_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL,
    `progress_date` DATE NOT NULL,
    `area_completed` DECIMAL(10, 2) NOT NULL,
    `plants_planted` INTEGER NOT NULL,
    `survival_percent` DECIMAL(5, 2) NULL,
    `remarks` TEXT NULL,

    INDEX `replanting_progress_replanting_id_position_idx`(`replanting_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `replanting_approval` (
    `id` CHAR(26) NOT NULL,
    `replanting_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL,
    `level` VARCHAR(60) NOT NULL,
    `approved_by` VARCHAR(255) NULL,
    `designation` VARCHAR(60) NULL,
    `status` VARCHAR(20) NOT NULL,
    `approved_date` DATE NULL,
    `signature_path` CHAR(26) NULL,
    `remarks` TEXT NULL,

    INDEX `replanting_approval_replanting_id_position_idx`(`replanting_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `replanting_master` ADD CONSTRAINT `replanting_master_estate_id_fkey` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `replanting_master` ADD CONSTRAINT `replanting_master_field_id_fkey` FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `replanting_gap_details` ADD CONSTRAINT `replanting_gap_details_replanting_id_fkey` FOREIGN KEY (`replanting_id`) REFERENCES `replanting_master`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `replanting_land_preparation` ADD CONSTRAINT `replanting_land_preparation_replanting_id_fkey` FOREIGN KEY (`replanting_id`) REFERENCES `replanting_master`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `replanting_material` ADD CONSTRAINT `replanting_material_replanting_id_fkey` FOREIGN KEY (`replanting_id`) REFERENCES `replanting_master`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `replanting_labour` ADD CONSTRAINT `replanting_labour_replanting_id_fkey` FOREIGN KEY (`replanting_id`) REFERENCES `replanting_master`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `replanting_planting_rows` ADD CONSTRAINT `replanting_planting_rows_replanting_id_fkey` FOREIGN KEY (`replanting_id`) REFERENCES `replanting_master`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `replanting_progress` ADD CONSTRAINT `replanting_progress_replanting_id_fkey` FOREIGN KEY (`replanting_id`) REFERENCES `replanting_master`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `replanting_approval` ADD CONSTRAINT `replanting_approval_replanting_id_fkey` FOREIGN KEY (`replanting_id`) REFERENCES `replanting_master`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `plant_censuses` (
    `id` CHAR(26) NOT NULL,
    `estate_id` CHAR(26) NOT NULL,
    `division_id` CHAR(26) NOT NULL,
    `section_id` CHAR(26) NOT NULL,
    `field_id` CHAR(26) NOT NULL,
    `census_date` DATE NOT NULL,
    `census_year` INTEGER NOT NULL,
    `survey_type` VARCHAR(40) NOT NULL,
    `row_from` INTEGER NOT NULL,
    `row_to` INTEGER NOT NULL,
    `total_selected_rows` INTEGER NOT NULL,
    `row_spacing` DECIMAL(6, 2) NOT NULL,
    `planting_year` INTEGER NOT NULL,
    `clone_variety` VARCHAR(60) NOT NULL,
    `elevation` DECIMAL(10, 2) NULL,
    `plant_spacing` DECIMAL(6, 2) NOT NULL,
    `census_by` VARCHAR(255) NOT NULL,
    `supervisor` VARCHAR(60) NOT NULL,
    `census_method` VARCHAR(40) NOT NULL,
    `remarks` TEXT NULL,
    `photos` JSON NOT NULL,
    `documents` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `plant_censuses_estate_id_census_year_idx`(`estate_id`, `census_year`),
    INDEX `plant_censuses_field_id_idx`(`field_id`),
    INDEX `plant_censuses_deleted_at_created_at_idx`(`deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `plant_census_rows` (
    `id` CHAR(26) NOT NULL,
    `census_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL,
    `row_no` VARCHAR(20) NOT NULL,
    `row_length` DECIMAL(10, 2) NOT NULL,
    `plants_per_meter` DECIMAL(6, 2) NOT NULL,
    `expected_plants` INTEGER NOT NULL,
    `live_plants` INTEGER NOT NULL,
    `dead_plants` INTEGER NOT NULL,
    `missing_plants` INTEGER NOT NULL,
    `gap_percentage` DECIMAL(6, 2) NOT NULL,

    INDEX `plant_census_rows_census_id_position_idx`(`census_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `plant_censuses` ADD CONSTRAINT `plant_censuses_estate_id_fkey` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plant_censuses` ADD CONSTRAINT `plant_censuses_field_id_fkey` FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `plant_census_rows` ADD CONSTRAINT `plant_census_rows_census_id_fkey` FOREIGN KEY (`census_id`) REFERENCES `plant_censuses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

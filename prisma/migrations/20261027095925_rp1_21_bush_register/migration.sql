-- CreateTable
CREATE TABLE `bush_registers` (
    `id` CHAR(26) NOT NULL,
    `estate_id` CHAR(26) NOT NULL,
    `division_id` CHAR(26) NOT NULL,
    `section_id` CHAR(26) NOT NULL,
    `field_id` CHAR(26) NOT NULL,
    `planting_year` INTEGER NOT NULL,
    `bush_age` INTEGER NOT NULL,
    `total_area` DECIMAL(12, 2) NOT NULL,
    `row_spacing` DECIMAL(6, 2) NOT NULL,
    `plant_spacing` DECIMAL(6, 2) NOT NULL,
    `survey_date` DATE NOT NULL,
    `surveyor` VARCHAR(255) NOT NULL,
    `bush_status` VARCHAR(40) NOT NULL,
    `bush_health` VARCHAR(40) NOT NULL,
    `production_zone` VARCHAR(40) NOT NULL,
    `row_direction` VARCHAR(40) NOT NULL,
    `small_gaps` INTEGER NULL,
    `medium_gaps` INTEGER NULL,
    `large_gaps` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `bush_registers_estate_id_survey_date_idx`(`estate_id`, `survey_date`),
    INDEX `bush_registers_field_id_idx`(`field_id`),
    INDEX `bush_registers_deleted_at_created_at_idx`(`deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bush_register_rows` (
    `id` CHAR(26) NOT NULL,
    `register_id` CHAR(26) NOT NULL,
    `row_no` VARCHAR(20) NOT NULL,
    `from_bush` INTEGER NOT NULL,
    `to_bush` INTEGER NOT NULL,
    `total_bush` INTEGER NOT NULL,
    `productive` INTEGER NOT NULL,
    `dead` INTEGER NOT NULL,
    `missing` INTEGER NOT NULL,
    `gap` DECIMAL(5, 2) NOT NULL,
    `height` DECIMAL(6, 2) NULL,
    `spread` DECIMAL(6, 2) NULL,
    `health` VARCHAR(20) NULL,
    `remarks` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `bush_register_rows_register_id_row_no_idx`(`register_id`, `row_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `bush_registers` ADD CONSTRAINT `bush_registers_estate_id_fkey` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bush_registers` ADD CONSTRAINT `bush_registers_field_id_fkey` FOREIGN KEY (`field_id`) REFERENCES `fields`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `bush_register_rows` ADD CONSTRAINT `bush_register_rows_register_id_fkey` FOREIGN KEY (`register_id`) REFERENCES `bush_registers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

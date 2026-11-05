-- CreateTable
CREATE TABLE `seasons` (
    `id` CHAR(26) NOT NULL,
    `season_name` VARCHAR(120) NOT NULL,
    `season_code` VARCHAR(40) NOT NULL,
    `season_type` VARCHAR(60) NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `status` VARCHAR(60) NOT NULL,
    `description` TEXT NULL,
    `remarks` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `seasons_season_code_idx`(`season_code`),
    INDEX `seasons_deleted_at_end_date_idx`(`deleted_at`, `end_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

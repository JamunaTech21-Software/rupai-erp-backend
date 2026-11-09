-- CreateTable
CREATE TABLE `auction_schedules` (
    `id` CHAR(26) NOT NULL,
    `season_id` CHAR(26) NOT NULL,
    `auction_center_id` CHAR(26) NOT NULL,
    `year` VARCHAR(9) NOT NULL,
    `sale_no` INTEGER NOT NULL,
    `sale_date` DATE NOT NULL,
    `sale_day` VARCHAR(10) NOT NULL,
    `buyer_prompt_date` DATE NOT NULL,
    `catalogue_closing_date` DATE NOT NULL,
    `comments` TEXT NULL,
    `status` VARCHAR(20) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `auction_schedules_season_id_auction_center_id_sale_no_idx`(`season_id`, `auction_center_id`, `sale_no`),
    INDEX `auction_schedules_auction_center_id_idx`(`auction_center_id`),
    INDEX `auction_schedules_deleted_at_sale_date_idx`(`deleted_at`, `sale_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `auction_schedules` ADD CONSTRAINT `auction_schedules_season_id_fkey` FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auction_schedules` ADD CONSTRAINT `auction_schedules_auction_center_id_fkey` FOREIGN KEY (`auction_center_id`) REFERENCES `auction_centers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

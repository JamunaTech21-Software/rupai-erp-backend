-- CreateTable
CREATE TABLE `broker_sale_positions` (
    `id` CHAR(26) NOT NULL,
    `auction_center_id` CHAR(26) NOT NULL,
    `auction_schedule_id` CHAR(26) NOT NULL,
    `broker_1_id` CHAR(26) NOT NULL,
    `broker_2_id` CHAR(26) NOT NULL,
    `broker_3_id` CHAR(26) NOT NULL,
    `broker_4_id` CHAR(26) NOT NULL,
    `broker_5_id` CHAR(26) NOT NULL,
    `broker_6_id` CHAR(26) NOT NULL,
    `broker_7_id` CHAR(26) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `broker_sale_positions_auction_schedule_id_idx`(`auction_schedule_id`),
    INDEX `broker_sale_positions_auction_center_id_idx`(`auction_center_id`),
    INDEX `broker_sale_positions_deleted_at_created_at_idx`(`deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `broker_sale_positions` ADD CONSTRAINT `broker_sale_positions_auction_center_id_fkey` FOREIGN KEY (`auction_center_id`) REFERENCES `auction_centers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `broker_sale_positions` ADD CONSTRAINT `broker_sale_positions_auction_schedule_id_fkey` FOREIGN KEY (`auction_schedule_id`) REFERENCES `auction_schedules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

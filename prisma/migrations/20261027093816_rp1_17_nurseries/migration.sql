-- CreateTable
CREATE TABLE `nurseries` (
    `id` CHAR(26) NOT NULL,
    `estate_id` CHAR(26) NOT NULL,
    `division_id` CHAR(26) NOT NULL,
    `nursery_name` VARCHAR(255) NOT NULL,
    `supervisor` VARCHAR(255) NOT NULL,
    `nursery_code` VARCHAR(60) NOT NULL,
    `nursery_type` VARCHAR(60) NOT NULL,
    `location` VARCHAR(255) NOT NULL,
    `irrigation_source` VARCHAR(60) NOT NULL,
    `established_year` INTEGER NOT NULL,
    `status` VARCHAR(40) NOT NULL,
    `total_area` DECIMAL(12, 2) NOT NULL,
    `net_usable_area` DECIMAL(12, 2) NOT NULL,
    `active` VARCHAR(60) NOT NULL,
    `remarks` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `nurseries_estate_id_nursery_code_idx`(`estate_id`, `nursery_code`),
    INDEX `nurseries_deleted_at_created_at_idx`(`deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nursery_beds` (
    `id` CHAR(26) NOT NULL,
    `nursery_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `code` VARCHAR(60) NOT NULL,
    `clone` VARCHAR(60) NOT NULL,
    `area` DECIMAL(10, 2) NOT NULL,
    `plants` INTEGER NOT NULL,
    `planting_date` DATE NOT NULL,
    `status` VARCHAR(40) NOT NULL,

    INDEX `nursery_beds_nursery_id_position_idx`(`nursery_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `nursery_stock` (
    `id` CHAR(26) NOT NULL,
    `nursery_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL,
    `clone` VARCHAR(60) NOT NULL,
    `type` VARCHAR(60) NOT NULL,
    `total_plants` INTEGER NOT NULL,
    `available_plants` INTEGER NOT NULL,
    `reserved_plants` INTEGER NOT NULL,
    `distributed_plants` INTEGER NOT NULL,
    `distributed_this_month` INTEGER NOT NULL DEFAULT 0,
    `unit` VARCHAR(20) NOT NULL DEFAULT 'Nos',

    INDEX `nursery_stock_nursery_id_position_idx`(`nursery_id`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `nurseries` ADD CONSTRAINT `nurseries_estate_id_fkey` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nurseries` ADD CONSTRAINT `nurseries_division_id_fkey` FOREIGN KEY (`division_id`) REFERENCES `divisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nursery_beds` ADD CONSTRAINT `nursery_beds_nursery_id_fkey` FOREIGN KEY (`nursery_id`) REFERENCES `nurseries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `nursery_stock` ADD CONSTRAINT `nursery_stock_nursery_id_fkey` FOREIGN KEY (`nursery_id`) REFERENCES `nurseries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

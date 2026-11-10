-- CreateTable
CREATE TABLE `brokers` (
    `id` CHAR(26) NOT NULL,
    `broker_code` VARCHAR(50) NOT NULL,
    `broker_name` VARCHAR(160) NOT NULL,
    `license_no` VARCHAR(60) NOT NULL,
    `contact_person_name` VARCHAR(120) NOT NULL,
    `designation` VARCHAR(40) NOT NULL,
    `phone` VARCHAR(30) NULL,
    `email` VARCHAR(160) NULL,
    `tin_no` VARCHAR(40) NULL,
    `commission` DECIMAL(5, 2) NOT NULL,
    `status` VARCHAR(20) NOT NULL,
    `address` VARCHAR(500) NOT NULL,
    `remarks` TEXT NULL,
    `auction_centers` JSON NOT NULL,
    `association` VARCHAR(20) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `brokers_broker_code_idx`(`broker_code`),
    INDEX `brokers_deleted_at_created_at_idx`(`deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `broker_mobiles` (
    `id` CHAR(26) NOT NULL,
    `broker_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL,
    `mobile_number` VARCHAR(30) NOT NULL,
    `contact_person_name` VARCHAR(120) NULL,
    `designation` VARCHAR(40) NULL,
    `type` VARCHAR(20) NOT NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,

    INDEX `broker_mobiles_broker_id_idx`(`broker_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `broker_mobiles` ADD CONSTRAINT `broker_mobiles_broker_id_fkey` FOREIGN KEY (`broker_id`) REFERENCES `brokers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

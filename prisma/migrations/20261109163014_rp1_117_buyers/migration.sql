-- CreateTable
CREATE TABLE `buyers` (
    `id` CHAR(26) NOT NULL,
    `buyer_code` VARCHAR(50) NOT NULL,
    `buyer_name` VARCHAR(150) NOT NULL,
    `short_name` VARCHAR(50) NULL,
    `buyer_type` VARCHAR(20) NOT NULL,
    `trading_type` VARCHAR(20) NOT NULL,
    `country` VARCHAR(40) NOT NULL,
    `address` VARCHAR(250) NOT NULL,
    `phone` VARCHAR(30) NULL,
    `email` VARCHAR(150) NULL,
    `status` VARCHAR(20) NOT NULL,
    `remarks` VARCHAR(250) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `buyers_buyer_code_idx`(`buyer_code`),
    INDEX `buyers_deleted_at_created_at_idx`(`deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `buyer_contacts` (
    `id` CHAR(26) NOT NULL,
    `buyer_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL,
    `mobile_number` VARCHAR(30) NOT NULL,
    `contact_person_name` VARCHAR(120) NOT NULL,
    `designation` VARCHAR(40) NOT NULL,
    `type` VARCHAR(20) NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,

    INDEX `buyer_contacts_buyer_id_idx`(`buyer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `buyer_contacts` ADD CONSTRAINT `buyer_contacts_buyer_id_fkey` FOREIGN KEY (`buyer_id`) REFERENCES `buyers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

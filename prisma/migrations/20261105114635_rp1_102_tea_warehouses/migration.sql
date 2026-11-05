-- CreateTable
CREATE TABLE `tea_warehouses` (
    `id` CHAR(26) NOT NULL,
    `warehouse_code` VARCHAR(50) NOT NULL,
    `warehouse_name` VARCHAR(120) NOT NULL,
    `short_name` VARCHAR(50) NULL,
    `location` VARCHAR(250) NOT NULL,
    `warehouse_type` VARCHAR(60) NOT NULL,
    `capacity` DECIMAL(12, 2) NULL,
    `in_charge_person` VARCHAR(120) NOT NULL,
    `office_phone` VARCHAR(30) NULL,
    `status` VARCHAR(60) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `tea_warehouses_warehouse_code_idx`(`warehouse_code`),
    INDEX `tea_warehouses_deleted_at_created_at_idx`(`deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tea_warehouse_mobiles` (
    `id` CHAR(26) NOT NULL,
    `warehouse_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL,
    `number` VARCHAR(30) NOT NULL,
    `contact_person` VARCHAR(120) NOT NULL,
    `designation` VARCHAR(120) NULL,
    `type` VARCHAR(60) NOT NULL,
    `primary` BOOLEAN NOT NULL DEFAULT false,

    INDEX `tea_warehouse_mobiles_warehouse_id_idx`(`warehouse_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tea_warehouse_mobiles` ADD CONSTRAINT `tea_warehouse_mobiles_warehouse_id_fkey` FOREIGN KEY (`warehouse_id`) REFERENCES `tea_warehouses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

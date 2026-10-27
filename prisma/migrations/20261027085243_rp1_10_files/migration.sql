-- CreateTable
CREATE TABLE `stored_files` (
    `id` CHAR(26) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `type` VARCHAR(100) NOT NULL,
    `size` INTEGER NOT NULL,
    `storage_key` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

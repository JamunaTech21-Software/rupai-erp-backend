-- AlterTable
ALTER TABLE `sections` ADD COLUMN `polygon` JSON NULL;

-- CreateTable
CREATE TABLE `estate_maps` (
    `id` CHAR(26) NOT NULL,
    `estate_id` CHAR(26) NOT NULL,
    `estate_boundary` JSON NOT NULL,
    `roads` JSON NOT NULL,
    `drains` JSON NOT NULL,
    `water_bodies` JSON NOT NULL,
    `buildings` JSON NOT NULL,
    `markers` JSON NOT NULL,
    `zoom` INTEGER NOT NULL DEFAULT 15,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,

    UNIQUE INDEX `estate_maps_estate_id_key`(`estate_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `estate_maps` ADD CONSTRAINT `estate_maps_estate_id_fkey` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

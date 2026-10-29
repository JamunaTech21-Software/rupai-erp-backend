-- RP1-54: a mouza list per estate; land_records.mouza becomes a mouza id.
-- The old values (the prototype's option values, e.g. "madhabpur") are moved into mouzas first, so no data
-- is lost: one mouza per estate and value, named from the value ("madhabpur" -> "Madhabpur").

-- CreateTable
CREATE TABLE `mouzas` (
    `id` CHAR(26) NOT NULL,
    `estate_id` CHAR(26) NOT NULL,
    `mouza_name` VARCHAR(120) NOT NULL,
    `jl_no` VARCHAR(60) NULL,
    `remarks` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `mouzas_estate_id_mouza_name_idx`(`estate_id`, `mouza_name`),
    INDEX `mouzas_deleted_at_created_at_idx`(`deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Move the existing values into mouzas (ids: "01MZ" + 22 hex characters, 26 in all).
INSERT INTO `mouzas` (`id`, `estate_id`, `mouza_name`, `created_by`, `updated_at`, `updated_by`)
SELECT CONCAT('01MZ', UPPER(SUBSTRING(REPLACE(UUID(), '-', ''), 1, 22))),
       t.`estate_id`, t.`mouza_name`, t.`created_by`, CURRENT_TIMESTAMP(3), t.`created_by`
FROM (
    SELECT `estate_id`,
           CONCAT(UPPER(LEFT(REPLACE(REPLACE(`mouza`, '_', ' '), '-', ' '), 1)),
                  SUBSTRING(REPLACE(REPLACE(`mouza`, '_', ' '), '-', ' '), 2)) AS `mouza_name`,
           MIN(`created_by`) AS `created_by`
    FROM `land_records`
    WHERE `mouza` IS NOT NULL AND `mouza` <> ''
    GROUP BY `estate_id`, `mouza_name`
) AS t;

UPDATE `land_records` AS l
JOIN `mouzas` AS m
  ON m.`estate_id` = l.`estate_id`
 AND m.`mouza_name` = CONCAT(UPPER(LEFT(REPLACE(REPLACE(l.`mouza`, '_', ' '), '-', ' '), 1)),
                             SUBSTRING(REPLACE(REPLACE(l.`mouza`, '_', ' '), '-', ' '), 2))
SET l.`mouza` = m.`id`
WHERE l.`mouza` IS NOT NULL AND l.`mouza` <> '';

UPDATE `land_records` SET `mouza` = NULL WHERE `mouza` = '';

-- AlterTable
ALTER TABLE `land_records` MODIFY `mouza` CHAR(26) NULL;

-- AddForeignKey
ALTER TABLE `land_records` ADD CONSTRAINT `land_records_mouza_fkey` FOREIGN KEY (`mouza`) REFERENCES `mouzas`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `mouzas` ADD CONSTRAINT `mouzas_estate_id_fkey` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

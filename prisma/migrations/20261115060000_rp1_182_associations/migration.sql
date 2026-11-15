-- RP1-182 P.1 Association Setup: the associations become Master Data records. Auction Center "Managed By"
-- and Add New Broker "Association" held fixed codes (ttab / small-tea-garden, TTAB / OTHER); they now hold
-- the association's id.

-- CreateTable
CREATE TABLE `associations` (
    `id` CHAR(26) NOT NULL,
    `association_code` VARCHAR(20) NOT NULL,
    `association_name` VARCHAR(160) NOT NULL,
    `short_name` VARCHAR(50) NULL,
    `status` VARCHAR(20) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `associations_association_code_idx`(`association_code`),
    INDEX `associations_deleted_at_association_code_idx`(`deleted_at`, `association_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The three associations of the old fixed lists, created by the first user. An empty database (no users yet)
-- gets none here: the seed adds them.
INSERT INTO `associations` (`id`, `association_code`, `association_name`, `short_name`, `status`, `created_at`, `created_by`, `updated_at`, `updated_by`)
SELECT a.`id`, a.`code`, a.`name`, a.`short`, 'ACTIVE', NOW(3), u.`id`, NOW(3), u.`id`
FROM (
    SELECT '01KA0P1A000000000000000001' AS `id`, 'TTAB' AS `code`, 'Tea Traders Association of Bangladesh (TTAB)' AS `name`, 'TTAB' AS `short`
    UNION ALL SELECT '01KA0P1A000000000000000002', 'STGOTTAB', 'Small Tea Garden Owners & Tea Traders Association of Bangladesh', 'Small Tea Garden'
    UNION ALL SELECT '01KA0P1A000000000000000003', 'OTHER', 'Other Association', 'Other'
) a
CROSS JOIN (SELECT `id` FROM `users` ORDER BY `created_at`, `id` LIMIT 1) u;

-- AlterTable: wide enough for an id before the codes are replaced (brokers.association was VARCHAR(20)).
ALTER TABLE `auction_centers` MODIFY `managed_by` CHAR(26) NOT NULL;
ALTER TABLE `brokers` MODIFY `association` CHAR(26) NOT NULL;

-- Saved codes to the records.
UPDATE `auction_centers`
SET `managed_by` = CASE `managed_by` WHEN 'small-tea-garden' THEN '01KA0P1A000000000000000002' ELSE '01KA0P1A000000000000000001' END;
UPDATE `brokers`
SET `association` = CASE `association` WHEN 'TTAB' THEN '01KA0P1A000000000000000001' ELSE '01KA0P1A000000000000000003' END;

-- Open approval requests hold the form as sent: move their codes too, so approving them still works.
UPDATE `change_requests`
SET `payload` = JSON_SET(`payload`, '$.managedBy', IF(JSON_UNQUOTE(JSON_EXTRACT(`payload`, '$.managedBy')) = 'small-tea-garden', '01KA0P1A000000000000000002', '01KA0P1A000000000000000001')),
    `new_data` = IF(JSON_EXTRACT(`new_data`, '$.managedBy') IS NULL, `new_data`, JSON_SET(`new_data`, '$.managedBy', IF(JSON_UNQUOTE(JSON_EXTRACT(`new_data`, '$.managedBy')) = 'small-tea-garden', '01KA0P1A000000000000000002', '01KA0P1A000000000000000001')))
WHERE `status` = 'pending' AND `resource` = 'auctionCenter' AND JSON_EXTRACT(`payload`, '$.managedBy') IN ('ttab', 'small-tea-garden');
UPDATE `change_requests`
SET `payload` = JSON_SET(`payload`, '$.association', IF(JSON_UNQUOTE(JSON_EXTRACT(`payload`, '$.association')) = 'TTAB', '01KA0P1A000000000000000001', '01KA0P1A000000000000000003')),
    `new_data` = IF(JSON_EXTRACT(`new_data`, '$.association') IS NULL, `new_data`, JSON_SET(`new_data`, '$.association', IF(JSON_UNQUOTE(JSON_EXTRACT(`new_data`, '$.association')) = 'TTAB', '01KA0P1A000000000000000001', '01KA0P1A000000000000000003')))
WHERE `status` = 'pending' AND `resource` = 'broker' AND JSON_EXTRACT(`payload`, '$.association') IN ('TTAB', 'OTHER');

-- CreateIndex
CREATE INDEX `auction_centers_managed_by_idx` ON `auction_centers`(`managed_by`);
CREATE INDEX `brokers_association_idx` ON `brokers`(`association`);

-- AddForeignKey
ALTER TABLE `auction_centers` ADD CONSTRAINT `auction_centers_managed_by_fkey` FOREIGN KEY (`managed_by`) REFERENCES `associations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `brokers` ADD CONSTRAINT `brokers_association_fkey` FOREIGN KEY (`association`) REFERENCES `associations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

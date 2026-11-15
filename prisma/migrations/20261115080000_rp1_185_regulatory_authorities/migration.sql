-- RP1-185 P.2 Regulatory Authority Setup: the authorities become Master Data records. Auction Center
-- "Regulatory Authority" held a fixed code (bangladesh-tea-board); it now holds the authority's id.

-- CreateTable
CREATE TABLE `regulatory_authorities` (
    `id` CHAR(26) NOT NULL,
    `authority_code` VARCHAR(20) NOT NULL,
    `authority_name` VARCHAR(160) NOT NULL,
    `short_name` VARCHAR(50) NULL,
    `status` VARCHAR(20) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `regulatory_authorities_authority_code_idx`(`authority_code`),
    INDEX `regulatory_authorities_deleted_at_authority_code_idx`(`deleted_at`, `authority_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- The old fixed list's one authority, created by the first user. An empty database (no users yet) gets none
-- here: the seed adds it.
INSERT INTO `regulatory_authorities` (`id`, `authority_code`, `authority_name`, `short_name`, `status`, `created_at`, `created_by`, `updated_at`, `updated_by`)
SELECT '01KA0P1B000000000000000001', 'BTB', 'Bangladesh Tea Board', 'BTB', 'ACTIVE', NOW(3), u.`id`, NOW(3), u.`id`
FROM (SELECT `id` FROM `users` ORDER BY `created_at`, `id` LIMIT 1) u;

-- AlterTable, then the saved code to the record.
ALTER TABLE `auction_centers` MODIFY `regulatory_authority` CHAR(26) NOT NULL;
UPDATE `auction_centers` SET `regulatory_authority` = '01KA0P1B000000000000000001';

-- Open approval requests hold the form as sent: move the code too, so approving them still works.
UPDATE `change_requests`
SET `payload` = JSON_SET(`payload`, '$.regulatoryAuthority', '01KA0P1B000000000000000001'),
    `new_data` = IF(JSON_EXTRACT(`new_data`, '$.regulatoryAuthority') IS NULL, `new_data`, JSON_SET(`new_data`, '$.regulatoryAuthority', '01KA0P1B000000000000000001'))
WHERE `status` = 'pending' AND `resource` = 'auctionCenter' AND JSON_EXTRACT(`payload`, '$.regulatoryAuthority') = 'bangladesh-tea-board';

-- CreateIndex
CREATE INDEX `auction_centers_regulatory_authority_idx` ON `auction_centers`(`regulatory_authority`);

-- AddForeignKey
ALTER TABLE `auction_centers` ADD CONSTRAINT `auction_centers_regulatory_authority_fkey` FOREIGN KEY (`regulatory_authority`) REFERENCES `regulatory_authorities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- RP1-211 P.7 Master Data clean-up (decision 2026-11-19): Add New Broker loses License No. and Association (its
-- auction centers already belong to an association); Tea Warehouse loses Warehouse Type; Tea Grade loses Standard /
-- Specification; Buyer Type keeps only Local and Packer.

-- Open approval requests in the old shape cannot be applied any more: reject them with a note, by the first user.
-- A buyer request is only rejected when it carries a Buyer Type that is no longer offered.
UPDATE `change_requests` cr
CROSS JOIN (SELECT `id` FROM `users` ORDER BY `created_at`, `id` LIMIT 1) u
SET cr.`status` = 'rejected',
    cr.`reviewed_by` = u.`id`,
    cr.`reviewed_at` = NOW(3),
    cr.`reject_reason` = 'Master Data fields removed (RP1-211): Broker License No. and Association, Warehouse Type, Grade Standard; Buyer Type only Local / Packer. Send the change again.'
WHERE cr.`status` = 'pending'
  AND (cr.`resource` IN ('broker', 'teaWarehouse', 'teaGrade')
       OR (cr.`resource` = 'buyer'
           AND JSON_EXTRACT(cr.`payload`, '$.buyerType') IS NOT NULL
           AND JSON_UNQUOTE(JSON_EXTRACT(cr.`payload`, '$.buyerType')) NOT IN ('LOCAL', 'PACKER')));

-- Buyer Type: every buyer (deleted ones too, as they can be restored) must already be Local or Packer; otherwise
-- stop here (the CHECK fails). Today: 7 Local, 3 Packer.
CREATE TEMPORARY TABLE `rp1_211_buyer_type_check` (
    `buyer_type` VARCHAR(20) NOT NULL,
    CONSTRAINT `rp1_211_buyer_type_ok` CHECK (`buyer_type` IN ('LOCAL', 'PACKER'))
);
INSERT INTO `rp1_211_buyer_type_check` (`buyer_type`) SELECT `buyer_type` FROM `buyers`;
DROP TEMPORARY TABLE `rp1_211_buyer_type_check`;

-- DropForeignKey
ALTER TABLE `brokers` DROP FOREIGN KEY `brokers_association_fkey`;

-- DropIndex
DROP INDEX `brokers_association_idx` ON `brokers`;

-- AlterTable
ALTER TABLE `brokers` DROP COLUMN `association`,
    DROP COLUMN `license_no`;

-- AlterTable
ALTER TABLE `tea_grades` DROP COLUMN `standard`;

-- AlterTable
ALTER TABLE `tea_warehouses` DROP COLUMN `warehouse_type`;

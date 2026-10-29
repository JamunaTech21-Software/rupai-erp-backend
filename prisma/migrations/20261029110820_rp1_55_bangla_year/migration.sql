-- AlterTable
ALTER TABLE `land_payments` ADD COLUMN `bangla_year` VARCHAR(4) NULL;

-- CreateIndex
CREATE INDEX `land_payments_land_record_id_bangla_year_idx` ON `land_payments`(`land_record_id`, `bangla_year`);

-- Backfill: Bangla year of each due date (the year starts on 14 April)
UPDATE `land_payments`
SET `bangla_year` = CAST(YEAR(`due_date`) - IF(DATE_FORMAT(`due_date`, '%m-%d') >= '04-14', 593, 594) AS CHAR)
WHERE `bangla_year` IS NULL;

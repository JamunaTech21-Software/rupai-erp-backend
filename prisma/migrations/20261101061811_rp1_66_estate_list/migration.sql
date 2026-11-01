-- RP1-66 Estate Profile List: short name and status; address becomes required in the API.

-- AlterTable: short name added empty first, filled below, then made required
ALTER TABLE `estates` ADD COLUMN `short_name` VARCHAR(30) NULL,
    ADD COLUMN `status` VARCHAR(20) NOT NULL DEFAULT 'Active';

-- Backfill: the first word of the estate name in capitals; a repeated word gets -2, -3, …
UPDATE `estates` e
JOIN (
  SELECT `id`,
         UPPER(SUBSTRING_INDEX(TRIM(`estate_name`), ' ', 1)) AS `word`,
         ROW_NUMBER() OVER (PARTITION BY UPPER(SUBSTRING_INDEX(TRIM(`estate_name`), ' ', 1)) ORDER BY `created_at`, `id`) AS `n`
  FROM `estates`
) x ON x.`id` = e.`id`
SET e.`short_name` = IF(x.`n` = 1, LEFT(x.`word`, 30), CONCAT(LEFT(x.`word`, 26), '-', x.`n`));

ALTER TABLE `estates` MODIFY `short_name` VARCHAR(30) NOT NULL;

-- Backfill: an empty address (the list's Location) from police station and district
UPDATE `estates`
SET `address` = NULLIF(CONCAT_WS(', ', NULLIF(TRIM(`police_station`), ''), NULLIF(TRIM(`district`), '')), '')
WHERE `address` IS NULL OR TRIM(`address`) = '';

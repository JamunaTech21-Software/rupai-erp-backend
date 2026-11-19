-- Buyer Setup (decision 2026-11-19): Trading Type is Internal, Export or Both (Import removed), and there is no
-- Country (all saved buyers were Bangladesh).

-- Open buyer requests that carry a Country or the Import trading type cannot be applied any more: reject them.
UPDATE `change_requests` cr
CROSS JOIN (SELECT `id` FROM `users` ORDER BY `created_at`, `id` LIMIT 1) u
SET cr.`status` = 'rejected',
    cr.`reviewed_by` = u.`id`,
    cr.`reviewed_at` = NOW(3),
    cr.`reject_reason` = 'Buyer Setup changed: no Country, Trading Type only Internal / Export / Both. Send the change again.'
WHERE cr.`status` = 'pending'
  AND cr.`resource` = 'buyer'
  AND (JSON_EXTRACT(cr.`payload`, '$.country') IS NOT NULL
       OR JSON_UNQUOTE(JSON_EXTRACT(cr.`payload`, '$.tradingType')) = 'IMPORT');

-- Every buyer (deleted ones too) must already be Internal, Export or Both; otherwise stop here (the CHECK fails).
CREATE TEMPORARY TABLE `buyer_trading_type_check` (
    `trading_type` VARCHAR(20) NOT NULL,
    CONSTRAINT `buyer_trading_type_ok` CHECK (`trading_type` IN ('INTERNAL', 'EXPORT', 'BOTH'))
);
INSERT INTO `buyer_trading_type_check` (`trading_type`) SELECT `trading_type` FROM `buyers`;
DROP TEMPORARY TABLE `buyer_trading_type_check`;

-- AlterTable
ALTER TABLE `buyers` DROP COLUMN `country`;

-- AlterTable
ALTER TABLE `documents` ADD COLUMN `expiring_from` DATE NULL;

-- CreateIndex
CREATE INDEX `documents_deleted_at_expiring_from_idx` ON `documents`(`deleted_at`, `expiring_from`);

-- Fill the new column for saved documents: Custom days first, else the type's turned-on reminders, else its
-- Default Reminder Days.
UPDATE `documents` d
JOIN `document_types` t ON t.`id` = d.`type_id`
SET d.`expiring_from` = DATE_SUB(d.`expiry_date`, INTERVAL COALESCE(
  (SELECT MAX(c.`v`) FROM JSON_TABLE(COALESCE(d.`reminder_days`, JSON_ARRAY()), '$[*]' COLUMNS (`v` INT PATH '$')) c
    WHERE d.`reminder_setting` = 'CUSTOM'),
  (SELECT MAX(r.`days`) FROM JSON_TABLE(t.`reminders`, '$[*]' COLUMNS (`enabled` BOOLEAN PATH '$.enabled', `days` INT PATH '$.days')) r
    WHERE r.`enabled`),
  t.`default_reminder_days`
) DAY)
WHERE d.`expiry_date` IS NOT NULL;

-- RP1-208 P.6 Tea Grade simplified (decision 2026-11-19): no Grade Code, Grade Size or Description; Grade Name
-- is the unique value; Tea Type (CTC / Green Tea / Orthodox) and Category (Leaf / Dust / Green-Ortho) are fixed
-- lists, so the Tea Type setup (tea_types) is removed.

-- Open approval requests in the old shape cannot be applied any more: reject them with a note, by the first user.
UPDATE `change_requests` cr
CROSS JOIN (SELECT `id` FROM `users` ORDER BY `created_at`, `id` LIMIT 1) u
SET cr.`status` = 'rejected',
    cr.`reviewed_by` = u.`id`,
    cr.`reviewed_at` = NOW(3),
    cr.`reject_reason` = 'Tea Grade changed (RP1-208): no Grade Code, Grade Size or Description, fixed Tea Type and Category, no Tea Type page. Send the change again.'
WHERE cr.`status` = 'pending' AND cr.`resource` IN ('teaGrade', 'teaType');

-- Two live grades with the same name would break the new unique Grade Name: stop here (duplicate key) if so.
CREATE TEMPORARY TABLE `rp1_208_name_check` (`grade_name` VARCHAR(120) NOT NULL, UNIQUE KEY (`grade_name`));
INSERT INTO `rp1_208_name_check` (`grade_name`) SELECT `grade_name` FROM `tea_grades` WHERE `deleted_at` IS NULL;
DROP TEMPORARY TABLE `rp1_208_name_check`;

-- Tea Type: the saved Tea Type record to the fixed value. A grade on any other type stays NULL, and the
-- NOT NULL change below then stops the migration (none today: 10 Orthodox, 2 CTC).
ALTER TABLE `tea_grades` ADD COLUMN `tea_type` VARCHAR(30) NULL;
UPDATE `tea_grades` g
JOIN `tea_types` t ON t.`id` = g.`tea_type_id`
SET g.`tea_type` = CASE
    WHEN t.`tea_type_code` = 'CTC' OR t.`tea_type_name` = 'CTC Tea' THEN 'CTC'
    WHEN t.`tea_type_code` = 'ORTH' OR t.`tea_type_name` = 'Orthodox Tea' THEN 'Orthodox'
    WHEN t.`tea_type_code` = 'GREEN' OR t.`tea_type_name` = 'Green Tea' THEN 'Green Tea'
    ELSE NULL
END;
ALTER TABLE `tea_grades` MODIFY `tea_type` VARCHAR(30) NOT NULL;

-- Category: Orthodox / CTC / Specialty become Leaf / Dust / Green-Ortho. A grade named "... Dust" is Dust, the
-- rest (Fannings too) Leaf; users change any of them with Edit.
UPDATE `tea_grades` SET `category` = IF(`grade_name` LIKE '%dust%', 'Dust', 'Leaf');

-- DropForeignKey
ALTER TABLE `tea_grades` DROP FOREIGN KEY `tea_grades_tea_type_id_fkey`;

-- DropIndex
DROP INDEX `tea_grades_grade_code_idx` ON `tea_grades`;
DROP INDEX `tea_grades_tea_type_id_idx` ON `tea_grades`;

-- AlterTable
ALTER TABLE `tea_grades` DROP COLUMN `description`,
    DROP COLUMN `grade_code`,
    DROP COLUMN `grade_size`,
    DROP COLUMN `tea_type_id`;

-- DropTable
DROP TABLE `tea_types`;

-- CreateIndex
CREATE INDEX `tea_grades_grade_name_idx` ON `tea_grades`(`grade_name`);
CREATE INDEX `tea_grades_tea_type_idx` ON `tea_grades`(`tea_type`);

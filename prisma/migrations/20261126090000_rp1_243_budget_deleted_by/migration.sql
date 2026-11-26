-- RP1-243: who deleted a budget (soft delete).
-- AlterTable
ALTER TABLE `budgets` ADD COLUMN `deleted_by` CHAR(26) NULL;


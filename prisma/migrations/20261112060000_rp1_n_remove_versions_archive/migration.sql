-- Plan change (2026-11-12): renewal versions and archive (RP1-154) are not in the designs; undo its migration.

-- DropForeignKey
ALTER TABLE `document_versions` DROP FOREIGN KEY `document_versions_document_id_fkey`;

-- DropIndex
DROP INDEX `documents_archived_at_idx` ON `documents`;

-- AlterTable
ALTER TABLE `documents` DROP COLUMN `archived_at`,
    DROP COLUMN `archived_by`,
    DROP COLUMN `version`;

-- DropTable
DROP TABLE `document_versions`;

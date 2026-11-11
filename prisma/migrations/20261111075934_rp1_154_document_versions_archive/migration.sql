-- AlterTable
ALTER TABLE `documents` ADD COLUMN `archived_at` DATETIME(3) NULL,
    ADD COLUMN `archived_by` CHAR(26) NULL,
    ADD COLUMN `version` INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE `document_versions` (
    `id` CHAR(26) NOT NULL,
    `document_id` CHAR(26) NOT NULL,
    `version` INTEGER NOT NULL,
    `document_no` VARCHAR(60) NOT NULL,
    `issuing_authority` VARCHAR(200) NULL,
    `issue_date` DATE NOT NULL,
    `expiry_date` DATE NULL,
    `validity_months` INTEGER NULL,
    `attachment` CHAR(26) NULL,
    `replaced_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `replaced_by` CHAR(26) NOT NULL,
    `approval_id` CHAR(26) NULL,

    INDEX `document_versions_replaced_at_idx`(`replaced_at`),
    UNIQUE INDEX `document_versions_document_id_version_key`(`document_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `documents_archived_at_idx` ON `documents`(`archived_at`);

-- AddForeignKey
ALTER TABLE `document_versions` ADD CONSTRAINT `document_versions_document_id_fkey` FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

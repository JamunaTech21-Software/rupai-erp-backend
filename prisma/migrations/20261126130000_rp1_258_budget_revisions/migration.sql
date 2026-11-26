-- RP1-258 B.8 budget revisions and their lines. New tables only.
-- CreateTable
CREATE TABLE `budget_revisions` (
    `id` CHAR(26) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `revision_no` VARCHAR(6) NOT NULL,
    `budget_id` CHAR(26) NOT NULL,
    `financial_year` VARCHAR(9) NOT NULL,
    `estate_id` CHAR(26) NOT NULL,
    `department` VARCHAR(30) NOT NULL,
    `category` VARCHAR(5) NOT NULL,
    `revision_type` VARCHAR(12) NOT NULL,
    `title` VARCHAR(150) NOT NULL,
    `revision_date` DATE NOT NULL,
    `justification` TEXT NULL,
    `remarks` TEXT NULL,
    `attachments` JSON NOT NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    `workflow_levels` JSON NULL,
    `current_step` INTEGER NULL,
    `submitted_at` DATETIME(3) NULL,
    `decided_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `budget_revisions_budget_id_department_status_idx`(`budget_id`, `department`, `status`),
    INDEX `budget_revisions_estate_id_financial_year_idx`(`estate_id`, `financial_year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `budget_revision_lines` (
    `id` CHAR(26) NOT NULL,
    `revision_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL,
    `head` VARCHAR(40) NOT NULL,
    `revision_amount` DECIMAL(15, 2) NOT NULL,
    `remarks` VARCHAR(250) NULL,
    `original_amount` DECIMAL(15, 2) NULL,

    INDEX `budget_revision_lines_revision_id_idx`(`revision_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `budget_revisions` ADD CONSTRAINT `budget_revisions_budget_id_fkey` FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `budget_revision_lines` ADD CONSTRAINT `budget_revision_lines_revision_id_fkey` FOREIGN KEY (`revision_id`) REFERENCES `budget_revisions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


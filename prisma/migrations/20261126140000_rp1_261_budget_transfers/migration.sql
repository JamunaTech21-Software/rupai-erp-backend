-- RP1-261 B.9 budget transfers and their lines. New tables only.
-- CreateTable
CREATE TABLE `budget_transfers` (
    `id` CHAR(26) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `transfer_date` DATE NOT NULL,
    `budget_id` CHAR(26) NOT NULL,
    `financial_year` VARCHAR(9) NOT NULL,
    `estate_id` CHAR(26) NOT NULL,
    `department` VARCHAR(30) NOT NULL,
    `transfer_type` VARCHAR(20) NOT NULL DEFAULT 'WITHIN_DEPARTMENT',
    `title` VARCHAR(150) NOT NULL,
    `remarks` TEXT NULL,
    `justification` TEXT NOT NULL,
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

    INDEX `budget_transfers_budget_id_department_status_idx`(`budget_id`, `department`, `status`),
    INDEX `budget_transfers_estate_id_financial_year_idx`(`estate_id`, `financial_year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `budget_transfer_lines` (
    `id` CHAR(26) NOT NULL,
    `transfer_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL,
    `from_head` VARCHAR(40) NOT NULL,
    `from_sub_head` VARCHAR(60) NULL,
    `to_head` VARCHAR(40) NOT NULL,
    `to_sub_head` VARCHAR(60) NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `remarks` VARCHAR(250) NULL,

    INDEX `budget_transfer_lines_transfer_id_idx`(`transfer_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `budget_transfers` ADD CONSTRAINT `budget_transfers_budget_id_fkey` FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `budget_transfer_lines` ADD CONSTRAINT `budget_transfer_lines_transfer_id_fkey` FOREIGN KEY (`transfer_id`) REFERENCES `budget_transfers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


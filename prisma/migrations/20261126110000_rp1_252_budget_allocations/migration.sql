-- RP1-252 B.6 monthly allocations and their lines. New tables only.
-- CreateTable
CREATE TABLE `budget_allocations` (
    `id` CHAR(26) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `budget_id` CHAR(26) NOT NULL,
    `financial_year` VARCHAR(9) NOT NULL,
    `estate_id` CHAR(26) NOT NULL,
    `allocation_method` VARCHAR(10) NOT NULL,
    `notes` TEXT NULL,
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

    INDEX `budget_allocations_budget_id_status_idx`(`budget_id`, `status`),
    INDEX `budget_allocations_estate_id_financial_year_idx`(`estate_id`, `financial_year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `budget_allocation_lines` (
    `id` CHAR(26) NOT NULL,
    `allocation_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL,
    `budget_line_id` CHAR(26) NOT NULL,
    `month_amounts` JSON NOT NULL,

    INDEX `budget_allocation_lines_allocation_id_idx`(`allocation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `budget_allocations` ADD CONSTRAINT `budget_allocations_budget_id_fkey` FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `budget_allocation_lines` ADD CONSTRAINT `budget_allocation_lines_allocation_id_fkey` FOREIGN KEY (`allocation_id`) REFERENCES `budget_allocations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


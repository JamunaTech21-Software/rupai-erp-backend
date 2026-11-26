-- RP1-246 B.4 / B.5 department budgets and their lines. New tables only.
-- CreateTable
CREATE TABLE `department_budgets` (
    `id` CHAR(26) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `budget_name` VARCHAR(150) NOT NULL,
    `budget_id` CHAR(26) NOT NULL,
    `financial_year` VARCHAR(9) NOT NULL,
    `estate_id` CHAR(26) NOT NULL,
    `budget_type` VARCHAR(10) NOT NULL,
    `department` VARCHAR(30) NOT NULL,
    `cost_center` VARCHAR(26) NOT NULL,
    `category` VARCHAR(5) NOT NULL,
    `reference` VARCHAR(120) NULL,
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

    INDEX `department_budgets_budget_id_department_idx`(`budget_id`, `department`),
    INDEX `department_budgets_estate_id_financial_year_idx`(`estate_id`, `financial_year`),
    INDEX `department_budgets_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `department_budget_lines` (
    `id` CHAR(26) NOT NULL,
    `department_budget_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL,
    `head` VARCHAR(40) NOT NULL,
    `sub_head` VARCHAR(60) NULL,
    `unit` VARCHAR(10) NULL,
    `annual_amount` DECIMAL(15, 2) NOT NULL,
    `allocation_method` VARCHAR(10) NOT NULL,
    `month_percents` JSON NOT NULL,
    `month_amounts` JSON NOT NULL,

    INDEX `department_budget_lines_department_budget_id_idx`(`department_budget_id`),
    INDEX `department_budget_lines_head_idx`(`head`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `department_budgets` ADD CONSTRAINT `department_budgets_budget_id_fkey` FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `department_budget_lines` ADD CONSTRAINT `department_budget_lines_department_budget_id_fkey` FOREIGN KEY (`department_budget_id`) REFERENCES `department_budgets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


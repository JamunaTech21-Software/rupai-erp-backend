-- RP1-243 B.3 Annual Budget Planning: budgets, budget lines, budget workflow log. New tables only.
-- CreateTable
CREATE TABLE `budgets` (
    `id` CHAR(26) NOT NULL,
    `budget_code` VARCHAR(30) NOT NULL,
    `budget_name` VARCHAR(150) NOT NULL,
    `financial_year` VARCHAR(9) NOT NULL,
    `estate_id` CHAR(26) NOT NULL,
    `budget_type` VARCHAR(10) NOT NULL,
    `category` VARCHAR(5) NOT NULL,
    `preparation_date` DATE NOT NULL,
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

    INDEX `budgets_estate_id_financial_year_idx`(`estate_id`, `financial_year`),
    INDEX `budgets_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `budget_lines` (
    `id` CHAR(26) NOT NULL,
    `budget_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL,
    `head` VARCHAR(40) NOT NULL,
    `category` VARCHAR(5) NOT NULL,
    `department` VARCHAR(30) NOT NULL,
    `cost_center` VARCHAR(26) NOT NULL,
    `annual_amount` DECIMAL(15, 2) NOT NULL,
    `allocation_method` VARCHAR(10) NOT NULL,
    `month_percents` JSON NOT NULL,
    `month_amounts` JSON NOT NULL,

    INDEX `budget_lines_budget_id_idx`(`budget_id`),
    INDEX `budget_lines_head_idx`(`head`),
    INDEX `budget_lines_department_idx`(`department`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `budget_workflow_logs` (
    `id` CHAR(26) NOT NULL,
    `doc_type` VARCHAR(20) NOT NULL,
    `doc_id` CHAR(26) NOT NULL,
    `level_key` VARCHAR(20) NULL,
    `level_name` VARCHAR(60) NULL,
    `action` VARCHAR(16) NOT NULL,
    `comment` TEXT NULL,
    `user_id` CHAR(26) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `budget_workflow_logs_doc_type_doc_id_idx`(`doc_type`, `doc_id`),
    INDEX `budget_workflow_logs_action_created_at_idx`(`action`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `budgets` ADD CONSTRAINT `budgets_estate_id_fkey` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `budget_lines` ADD CONSTRAINT `budget_lines_budget_id_fkey` FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


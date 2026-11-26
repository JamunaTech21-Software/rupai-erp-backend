-- RP1-255 B.7 budget expenses (actual and commitment). New table only.
-- CreateTable
CREATE TABLE `budget_expenses` (
    `id` CHAR(26) NOT NULL,
    `code` VARCHAR(30) NOT NULL,
    `expense_date` DATE NOT NULL,
    `financial_year` VARCHAR(9) NOT NULL,
    `estate_id` CHAR(26) NOT NULL,
    `department` VARCHAR(30) NOT NULL,
    `cost_center` VARCHAR(26) NOT NULL,
    `head` VARCHAR(40) NOT NULL,
    `sub_head` VARCHAR(60) NULL,
    `category` VARCHAR(5) NOT NULL,
    `type` VARCHAR(10) NOT NULL,
    `reference_no` VARCHAR(60) NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `description` TEXT NULL,
    `attachments` JSON NOT NULL,
    `budget_id` CHAR(26) NULL,
    `paid_date` DATE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `budget_expenses_estate_id_financial_year_department_head_idx`(`estate_id`, `financial_year`, `department`, `head`),
    INDEX `budget_expenses_expense_date_idx`(`expense_date`),
    INDEX `budget_expenses_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `budget_expenses` ADD CONSTRAINT `budget_expenses_estate_id_fkey` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `budget_expenses` ADD CONSTRAINT `budget_expenses_budget_id_fkey` FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


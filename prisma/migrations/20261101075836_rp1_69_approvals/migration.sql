-- AlterTable
ALTER TABLE `record_history` ADD COLUMN `approval_id` CHAR(26) NULL;

-- CreateTable
CREATE TABLE `change_requests` (
    `id` CHAR(26) NOT NULL,
    `seq` INTEGER NOT NULL AUTO_INCREMENT,
    `module` VARCHAR(40) NOT NULL,
    `resource` VARCHAR(60) NOT NULL,
    `page` VARCHAR(120) NOT NULL,
    `applier` VARCHAR(80) NOT NULL,
    `record_id` CHAR(26) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `payload` JSON NULL,
    `new_data` JSON NULL,
    `old_data` JSON NULL,
    `record_updated_at` DATETIME(3) NULL,
    `summary` VARCHAR(500) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `requested_by` CHAR(26) NOT NULL,
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewed_by` CHAR(26) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `reject_reason` TEXT NULL,
    `error` TEXT NULL,

    UNIQUE INDEX `change_requests_seq_key`(`seq`),
    INDEX `change_requests_status_requested_at_idx`(`status`, `requested_at`),
    INDEX `change_requests_module_status_requested_at_idx`(`module`, `status`, `requested_at`),
    INDEX `change_requests_resource_record_id_status_idx`(`resource`, `record_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `approval_settings` (
    `module` VARCHAR(40) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NULL,

    PRIMARY KEY (`module`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

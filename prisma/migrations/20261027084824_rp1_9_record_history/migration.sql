-- CreateTable
CREATE TABLE `record_history` (
    `id` CHAR(26) NOT NULL,
    `resource` VARCHAR(60) NOT NULL,
    `record_id` CHAR(26) NOT NULL,
    `action` VARCHAR(20) NOT NULL,
    `old_data` JSON NULL,
    `new_data` JSON NULL,
    `changed_by` CHAR(26) NOT NULL,
    `changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `record_history_resource_record_id_changed_at_idx`(`resource`, `record_id`, `changed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

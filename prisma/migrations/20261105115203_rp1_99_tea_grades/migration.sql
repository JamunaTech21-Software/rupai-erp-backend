-- CreateTable
CREATE TABLE `tea_grades` (
    `id` CHAR(26) NOT NULL,
    `grade_code` VARCHAR(40) NOT NULL,
    `grade_name` VARCHAR(120) NOT NULL,
    `tea_type_id` CHAR(26) NOT NULL,
    `category` VARCHAR(60) NOT NULL,
    `standard` VARCHAR(120) NULL,
    `grade_size` VARCHAR(60) NULL,
    `status` VARCHAR(60) NOT NULL,
    `description` TEXT NULL,
    `remarks` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `tea_grades_grade_code_idx`(`grade_code`),
    INDEX `tea_grades_tea_type_id_idx`(`tea_type_id`),
    INDEX `tea_grades_deleted_at_created_at_idx`(`deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tea_grades` ADD CONSTRAINT `tea_grades_tea_type_id_fkey` FOREIGN KEY (`tea_type_id`) REFERENCES `tea_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

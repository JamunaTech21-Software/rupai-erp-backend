-- CreateTable
CREATE TABLE `workers` (
    `id` CHAR(26) NOT NULL,
    `worker_id` VARCHAR(20) NOT NULL,
    `worker_type` VARCHAR(60) NOT NULL,
    `category` VARCHAR(60) NOT NULL,
    `title` VARCHAR(20) NULL,
    `first_name` VARCHAR(255) NOT NULL,
    `middle_name` VARCHAR(255) NULL,
    `last_name` VARCHAR(255) NOT NULL,
    `fathers_name` VARCHAR(255) NOT NULL,
    `mothers_name` VARCHAR(255) NOT NULL,
    `date_of_birth` DATE NOT NULL,
    `gender` VARCHAR(20) NOT NULL,
    `blood_group` VARCHAR(20) NULL,
    `marital_status` VARCHAR(20) NOT NULL,
    `nationality` VARCHAR(60) NOT NULL,
    `religion` VARCHAR(60) NOT NULL,
    `tin_no` VARCHAR(60) NULL,
    `garden_unit` VARCHAR(60) NOT NULL,
    `section` VARCHAR(60) NOT NULL,
    `job_task` VARCHAR(60) NOT NULL,
    `worker_status` VARCHAR(60) NOT NULL,
    `join_date` DATE NOT NULL,
    `employment_type` VARCHAR(60) NULL,
    `job_nature` VARCHAR(60) NULL,
    `number_of_dependents` INTEGER NOT NULL,
    `reporting_to` VARCHAR(60) NULL,
    `working_location` VARCHAR(60) NULL,
    `employment_status` VARCHAR(60) NULL,
    `probation_end_date` DATE NULL,
    `mobile_no` VARCHAR(20) NOT NULL,
    `alternate_mobile` VARCHAR(20) NULL,
    `personal_email` VARCHAR(160) NULL,
    `present_address` TEXT NOT NULL,
    `permanent_address` TEXT NOT NULL,
    `same_as_present_address` BOOLEAN NOT NULL,
    `district` VARCHAR(60) NOT NULL,
    `upazila` VARCHAR(60) NOT NULL,
    `postal_code` VARCHAR(20) NULL,
    `worker_photo` CHAR(26) NULL,
    `face` CHAR(26) NULL,
    `right_thumb` CHAR(26) NULL,
    `left_thumb` CHAR(26) NULL,
    `land_distributed` VARCHAR(10) NOT NULL,
    `land_type` VARCHAR(60) NULL,
    `total_land` DECIMAL(10, 2) NULL,
    `reson_card_no` VARCHAR(60) NULL,
    `issue_date` DATE NULL,
    `valid_till` DATE NULL,
    `reason_dealer_office` VARCHAR(255) NULL,
    `reson_card_file` CHAR(26) NULL,
    `education_level` VARCHAR(60) NULL,
    `skill_training` VARCHAR(60) NULL,
    `language_known` VARCHAR(60) NULL,
    `experience_year` INTEGER NULL,
    `emergency_contact_name` VARCHAR(255) NULL,
    `emergency_contact_no` VARCHAR(20) NULL,
    `bank_name` VARCHAR(255) NULL,
    `account_no` VARCHAR(60) NULL,
    `mobile_banking` VARCHAR(60) NULL,
    `nid_front` CHAR(26) NOT NULL,
    `nid_back` CHAR(26) NOT NULL,
    `birth_certificate` CHAR(26) NULL,
    `nominee_id_card` CHAR(26) NULL,
    `training_certificate` CHAR(26) NULL,
    `other_document` CHAR(26) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `workers_worker_id_idx`(`worker_id`),
    INDEX `workers_garden_unit_section_idx`(`garden_unit`, `section`),
    INDEX `workers_worker_status_idx`(`worker_status`),
    INDEX `workers_deleted_at_created_at_idx`(`deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `worker_lands` (
    `id` CHAR(26) NOT NULL,
    `worker_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL,
    `plot_block_no` VARCHAR(60) NOT NULL,
    `mouza` VARCHAR(120) NULL,
    `area` DECIMAL(10, 2) NOT NULL,
    `distributed_date` DATE NULL,

    INDEX `worker_lands_worker_id_idx`(`worker_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `worker_dependents` (
    `id` CHAR(26) NOT NULL,
    `worker_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `relation` VARCHAR(40) NOT NULL,
    `date_of_birth` DATE NULL,
    `occupation` VARCHAR(120) NULL,

    INDEX `worker_dependents_worker_id_idx`(`worker_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `worker_lands` ADD CONSTRAINT `worker_lands_worker_id_fkey` FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `worker_dependents` ADD CONSTRAINT `worker_dependents_worker_id_fkey` FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

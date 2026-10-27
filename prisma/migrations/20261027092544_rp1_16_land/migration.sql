-- CreateTable
CREATE TABLE `land_records` (
    `id` CHAR(26) NOT NULL,
    `estate_id` CHAR(26) NOT NULL,
    `land_lease_type` VARCHAR(40) NOT NULL,
    `land_category` VARCHAR(40) NOT NULL,
    `land_lease_name` VARCHAR(255) NOT NULL,
    `survey_no` VARCHAR(100) NOT NULL,
    `plot_no` VARCHAR(100) NOT NULL,
    `mouza` VARCHAR(60) NULL,
    `jl_no` VARCHAR(100) NULL,
    `record_type` VARCHAR(40) NULL,
    `owner_name` VARCHAR(255) NOT NULL,
    `father_or_company_name` VARCHAR(255) NULL,
    `owner_mobile` VARCHAR(40) NULL,
    `owner_email` VARCHAR(160) NULL,
    `owner_nid_tin` VARCHAR(60) NULL,
    `owner_address` TEXT NULL,
    `ownership_remarks` TEXT NULL,
    `total_area` DECIMAL(12, 2) NOT NULL,
    `usable_area` DECIMAL(12, 2) NULL,
    `non_usable_area` DECIMAL(12, 2) NULL,
    `land_status` VARCHAR(40) NOT NULL,
    `acquisition_date` DATE NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `lease_term` VARCHAR(60) NULL,
    `rent_amount` DECIMAL(14, 2) NULL,
    `rent_per_acre` DECIMAL(14, 2) NULL,
    `location` VARCHAR(255) NULL,
    `gps_area` VARCHAR(60) NULL,
    `latitude` DECIMAL(10, 7) NULL,
    `longitude` DECIMAL(10, 7) NULL,
    `purpose` TEXT NULL,
    `polygon` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `land_records_estate_id_idx`(`estate_id`),
    INDEX `land_records_deleted_at_created_at_idx`(`deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `land_payments` (
    `id` CHAR(26) NOT NULL,
    `land_record_id` CHAR(26) NOT NULL,
    `year` VARCHAR(4) NOT NULL,
    `due_date` DATE NOT NULL,
    `amount` DECIMAL(14, 2) NOT NULL,
    `paid_amount` DECIMAL(14, 2) NULL,
    `payment_date` DATE NULL,
    `status` VARCHAR(20) NOT NULL,
    `payment_method` VARCHAR(40) NOT NULL,
    `reference_no` VARCHAR(100) NULL,
    `remarks` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `land_payments_land_record_id_year_idx`(`land_record_id`, `year`),
    INDEX `land_payments_deleted_at_created_at_idx`(`deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `land_documents` (
    `id` CHAR(26) NOT NULL,
    `land_record_id` CHAR(26) NOT NULL,
    `document_name` VARCHAR(255) NOT NULL,
    `document_type` VARCHAR(40) NOT NULL,
    `document_number` VARCHAR(100) NULL,
    `issue_date` DATE NULL,
    `expiry_date` DATE NULL,
    `file` CHAR(26) NOT NULL,
    `remarks` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `land_documents_land_record_id_idx`(`land_record_id`),
    INDEX `land_documents_deleted_at_created_at_idx`(`deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `land_records` ADD CONSTRAINT `land_records_estate_id_fkey` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `land_payments` ADD CONSTRAINT `land_payments_land_record_id_fkey` FOREIGN KEY (`land_record_id`) REFERENCES `land_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `land_documents` ADD CONSTRAINT `land_documents_land_record_id_fkey` FOREIGN KEY (`land_record_id`) REFERENCES `land_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

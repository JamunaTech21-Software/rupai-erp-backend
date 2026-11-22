-- RP1-218 W.2 Daily Weather Entry: one entry per date and station (Draft / Submitted).

-- CreateTable
CREATE TABLE `weather_entries` (
    `id` CHAR(26) NOT NULL,
    `entry_date` DATE NOT NULL,
    `estate_id` CHAR(26) NOT NULL,
    `station_id` CHAR(26) NOT NULL,
    `location` VARCHAR(160) NOT NULL,
    `entry_type` VARCHAR(10) NOT NULL,
    `recording_time` VARCHAR(5) NOT NULL,
    `entry_status` VARCHAR(10) NOT NULL,
    `total_rainfall` DECIMAL(6, 1) NOT NULL,
    `measurement_time` VARCHAR(5) NULL,
    `rain_gauge_type` VARCHAR(10) NULL,
    `rainfall_duration` VARCHAR(5) NULL,
    `morning_rainfall` DECIMAL(6, 1) NULL,
    `afternoon_rainfall` DECIMAL(6, 1) NULL,
    `evening_rainfall` DECIMAL(6, 1) NULL,
    `rainfall_remarks` VARCHAR(300) NULL,
    `max_temperature` DECIMAL(4, 1) NOT NULL,
    `min_temperature` DECIMAL(4, 1) NOT NULL,
    `avg_temperature` DECIMAL(4, 1) NOT NULL,
    `morning_temperature` DECIMAL(4, 1) NULL,
    `afternoon_temperature` DECIMAL(4, 1) NULL,
    `evening_temperature` DECIMAL(4, 1) NULL,
    `morning_humidity` DECIMAL(4, 1) NULL,
    `afternoon_humidity` DECIMAL(4, 1) NULL,
    `max_humidity` DECIMAL(4, 1) NULL,
    `min_humidity` DECIMAL(4, 1) NULL,
    `avg_humidity` DECIMAL(4, 1) NULL,
    `wind_speed` DECIMAL(5, 1) NULL,
    `max_wind_speed` DECIMAL(5, 1) NULL,
    `wind_direction` VARCHAR(2) NULL,
    `wind_remarks` VARCHAR(300) NULL,
    `sunshine_hours` DECIMAL(4, 1) NULL,
    `cloud_coverage` DECIMAL(4, 1) NULL,
    `weather_condition` VARCHAR(20) NOT NULL,
    `fog` BOOLEAN NOT NULL DEFAULT false,
    `thunderstorm` BOOLEAN NOT NULL DEFAULT false,
    `hailstorm` BOOLEAN NOT NULL DEFAULT false,
    `general_remarks` TEXT NULL,
    `attachments` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `weather_entries_station_id_entry_date_idx`(`station_id`, `entry_date`),
    INDEX `weather_entries_estate_id_entry_date_idx`(`estate_id`, `entry_date`),
    INDEX `weather_entries_entry_status_entry_date_idx`(`entry_status`, `entry_date`),
    INDEX `weather_entries_deleted_at_created_at_idx`(`deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `weather_entries` ADD CONSTRAINT `weather_entries_estate_id_fkey` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `weather_entries` ADD CONSTRAINT `weather_entries_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `weather_stations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


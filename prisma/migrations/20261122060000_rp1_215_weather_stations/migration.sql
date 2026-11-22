-- RP1-215 W.1 Weather Station Setup: weather stations and their installed sensors (Weather Management).

-- CreateTable
CREATE TABLE `weather_stations` (
    `id` CHAR(26) NOT NULL,
    `station_code` VARCHAR(20) NOT NULL,
    `station_name` VARCHAR(120) NOT NULL,
    `estate_id` CHAR(26) NOT NULL,
    `location` VARCHAR(160) NOT NULL,
    `entry_type` VARCHAR(10) NOT NULL,
    `status` VARCHAR(10) NOT NULL,
    `device_id` VARCHAR(60) NULL,
    `installation_date` DATE NULL,
    `data_interval` VARCHAR(5) NULL,
    `communication` VARCHAR(20) NULL,
    `data_endpoint` VARCHAR(500) NULL,
    `latitude` DECIMAL(9, 6) NOT NULL,
    `longitude` DECIMAL(9, 6) NOT NULL,
    `elevation` DECIMAL(8, 2) NULL,
    `timezone` VARCHAR(40) NOT NULL,
    `photo` CHAR(26) NULL,
    `data_mapping` JSON NOT NULL,
    `remarks` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(26) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `updated_by` CHAR(26) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` CHAR(26) NULL,

    INDEX `weather_stations_station_code_idx`(`station_code`),
    INDEX `weather_stations_estate_id_idx`(`estate_id`),
    INDEX `weather_stations_deleted_at_created_at_idx`(`deleted_at`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `weather_station_sensors` (
    `id` CHAR(26) NOT NULL,
    `station_id` CHAR(26) NOT NULL,
    `position` INTEGER NOT NULL,
    `sensor_name` VARCHAR(120) NOT NULL,
    `parameter` VARCHAR(20) NOT NULL,
    `unit` VARCHAR(20) NULL,
    `status` VARCHAR(10) NOT NULL,

    INDEX `weather_station_sensors_station_id_idx`(`station_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `weather_stations` ADD CONSTRAINT `weather_stations_estate_id_fkey` FOREIGN KEY (`estate_id`) REFERENCES `estates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `weather_station_sensors` ADD CONSTRAINT `weather_station_sensors_station_id_fkey` FOREIGN KEY (`station_id`) REFERENCES `weather_stations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


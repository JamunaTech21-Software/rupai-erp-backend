-- RP1-194 P.5: contact details for associations and regulatory authorities (optional columns only).
ALTER TABLE `associations`
    ADD COLUMN `contact_person` VARCHAR(120) NULL,
    ADD COLUMN `designation` VARCHAR(80) NULL,
    ADD COLUMN `phone` VARCHAR(30) NULL,
    ADD COLUMN `email` VARCHAR(160) NULL,
    ADD COLUMN `website` VARCHAR(255) NULL,
    ADD COLUMN `address` VARCHAR(500) NULL;

ALTER TABLE `regulatory_authorities`
    ADD COLUMN `contact_person` VARCHAR(120) NULL,
    ADD COLUMN `designation` VARCHAR(80) NULL,
    ADD COLUMN `phone` VARCHAR(30) NULL,
    ADD COLUMN `email` VARCHAR(160) NULL,
    ADD COLUMN `website` VARCHAR(255) NULL,
    ADD COLUMN `address` VARCHAR(500) NULL;


-- RP1-89 Add New Contractor: "Same as Present Address". Existing contractors stay as they are.
ALTER TABLE `contractors` ADD COLUMN `same_as_present` BOOLEAN NOT NULL DEFAULT false;

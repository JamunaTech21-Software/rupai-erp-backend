-- RP1-173: the user's own photo (stored file id).
ALTER TABLE `users` ADD COLUMN `photo` CHAR(26) NULL;

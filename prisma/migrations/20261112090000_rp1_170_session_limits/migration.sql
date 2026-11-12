-- RP1-170: a session ends 8 hours after sign-in; each refresh token keeps the sign-in time.
ALTER TABLE `refresh_tokens` ADD COLUMN `started_at` DATETIME(3) NULL;

-- Tokens issued before this change count from when they were issued, and end within the new limit.
UPDATE `refresh_tokens` SET `started_at` = `created_at`;
UPDATE `refresh_tokens` SET `expires_at` = LEAST(`expires_at`, DATE_ADD(`created_at`, INTERVAL 8 HOUR));

ALTER TABLE `refresh_tokens` MODIFY `started_at` DATETIME(3) NOT NULL;

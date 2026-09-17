-- AlterTable
ALTER TABLE `chatmessage` ADD COLUMN `usageJson` MEDIUMTEXT NULL;

-- AlterTable
ALTER TABLE `chatsession` ADD COLUMN `injectedContext` MEDIUMTEXT NULL;

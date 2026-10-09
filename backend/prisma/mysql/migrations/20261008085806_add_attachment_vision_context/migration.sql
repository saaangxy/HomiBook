-- AlterTable
ALTER TABLE `recordattachment` ADD COLUMN `visionAt` DATETIME(3) NULL,
    ADD COLUMN `visionMeta` VARCHAR(191) NULL,
    ADD COLUMN `visionSummary` VARCHAR(191) NULL,
    ADD COLUMN `visionText` VARCHAR(191) NULL;

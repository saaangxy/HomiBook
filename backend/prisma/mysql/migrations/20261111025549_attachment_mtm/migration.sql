-- DropForeignKey
ALTER TABLE `recordattachment` DROP FOREIGN KEY `RecordAttachment_recordId_fkey`;

-- CreateTable
CREATE TABLE `_RecordToRecordAttachment` (
    `A` VARCHAR(191) NOT NULL,
    `B` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `_RecordToRecordAttachment_AB_unique`(`A`, `B`),
    INDEX `_RecordToRecordAttachment_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 回填历史关联：必须在删除 recordId 列之前执行，否则附件与流水的关联会丢失
INSERT INTO `_RecordToRecordAttachment` (`A`, `B`)
SELECT `recordId`, `id` FROM `recordattachment` WHERE `recordId` IS NOT NULL;

-- DropIndex
DROP INDEX `RecordAttachment_recordId_fkey` ON `recordattachment`;

-- AlterTable
ALTER TABLE `recordattachment` DROP COLUMN `recordId`;

-- AddForeignKey
ALTER TABLE `_RecordToRecordAttachment` ADD CONSTRAINT `_RecordToRecordAttachment_A_fkey` FOREIGN KEY (`A`) REFERENCES `Record`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_RecordToRecordAttachment` ADD CONSTRAINT `_RecordToRecordAttachment_B_fkey` FOREIGN KEY (`B`) REFERENCES `RecordAttachment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

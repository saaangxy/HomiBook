-- AlterTable
ALTER TABLE `record` ADD COLUMN `offsetAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `Record_accountBookId_offsetAt_idx` ON `Record`(`accountBookId`, `offsetAt`);

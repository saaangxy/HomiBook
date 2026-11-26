-- 多维度预算：新增家庭成员维度，移除旧的同名唯一键（改为应用层校验）
ALTER TABLE `Budget` DROP INDEX `Budget_accountBookId_type_year_month_name_key`;

ALTER TABLE `Budget` ADD COLUMN `ownerId` VARCHAR(191) NULL;

CREATE INDEX `Budget_accountBookId_ownerId_idx` ON `Budget`(`accountBookId`, `ownerId`);

ALTER TABLE `Budget` ADD CONSTRAINT `Budget_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

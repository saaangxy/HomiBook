-- AlterTable
ALTER TABLE "User" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "Account" ADD COLUMN "deletedAt" DATETIME;

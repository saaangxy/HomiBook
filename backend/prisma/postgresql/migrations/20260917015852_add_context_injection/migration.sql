-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "usageJson" TEXT;

-- AlterTable
ALTER TABLE "ChatSession" ADD COLUMN     "injectedContext" TEXT;

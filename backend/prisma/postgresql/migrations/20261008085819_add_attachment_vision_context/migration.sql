-- AlterTable
ALTER TABLE "RecordAttachment" ADD COLUMN     "visionAt" TIMESTAMP(3),
ADD COLUMN     "visionMeta" TEXT,
ADD COLUMN     "visionSummary" TEXT,
ADD COLUMN     "visionText" TEXT;

-- AlterTable
ALTER TABLE "Record" ADD COLUMN "offsetAt" DATETIME;

-- CreateIndex
CREATE INDEX "Record_accountBookId_offsetAt_idx" ON "Record"("accountBookId", "offsetAt");

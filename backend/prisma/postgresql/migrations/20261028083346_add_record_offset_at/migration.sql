-- AlterTable
ALTER TABLE "Record" ADD COLUMN     "offsetAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Record_accountBookId_offsetAt_idx" ON "Record"("accountBookId", "offsetAt");

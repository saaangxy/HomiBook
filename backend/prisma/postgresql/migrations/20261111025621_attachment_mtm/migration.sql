-- DropForeignKey
ALTER TABLE "RecordAttachment" DROP CONSTRAINT "RecordAttachment_recordId_fkey";

-- CreateTable
CREATE TABLE "_RecordToRecordAttachment" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RecordToRecordAttachment_AB_pkey" PRIMARY KEY ("A","B")
);

-- 回填历史关联：必须在删除 recordId 列之前执行，否则附件与流水的关联会丢失
INSERT INTO "_RecordToRecordAttachment" ("A", "B")
SELECT "recordId", "id" FROM "RecordAttachment" WHERE "recordId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "_RecordToRecordAttachment_B_index" ON "_RecordToRecordAttachment"("B");

-- AlterTable
ALTER TABLE "RecordAttachment" DROP COLUMN "recordId";

-- AddForeignKey
ALTER TABLE "_RecordToRecordAttachment" ADD CONSTRAINT "_RecordToRecordAttachment_A_fkey" FOREIGN KEY ("A") REFERENCES "Record"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RecordToRecordAttachment" ADD CONSTRAINT "_RecordToRecordAttachment_B_fkey" FOREIGN KEY ("B") REFERENCES "RecordAttachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

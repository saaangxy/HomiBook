-- CreateTable
CREATE TABLE "_RecordToRecordAttachment" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_RecordToRecordAttachment_A_fkey" FOREIGN KEY ("A") REFERENCES "Record" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_RecordToRecordAttachment_B_fkey" FOREIGN KEY ("B") REFERENCES "RecordAttachment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 回填历史关联：必须在删除 recordId 列之前执行，否则附件与流水的关联会丢失
INSERT INTO "_RecordToRecordAttachment" ("A", "B")
SELECT "recordId", "id" FROM "RecordAttachment" WHERE "recordId" IS NOT NULL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RecordAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "path" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visionSummary" TEXT,
    "visionText" TEXT,
    "visionMeta" TEXT,
    "visionAt" DATETIME
);
INSERT INTO "new_RecordAttachment" ("createdAt", "id", "originalFilename", "path", "visionAt", "visionMeta", "visionSummary", "visionText") SELECT "createdAt", "id", "originalFilename", "path", "visionAt", "visionMeta", "visionSummary", "visionText" FROM "RecordAttachment";
DROP TABLE "RecordAttachment";
ALTER TABLE "new_RecordAttachment" RENAME TO "RecordAttachment";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "_RecordToRecordAttachment_AB_unique" ON "_RecordToRecordAttachment"("A", "B");

-- CreateIndex
CREATE INDEX "_RecordToRecordAttachment_B_index" ON "_RecordToRecordAttachment"("B");

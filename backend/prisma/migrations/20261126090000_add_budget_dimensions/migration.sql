-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Budget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountBookId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    "categoryCode" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "ownerId" TEXT,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "remark" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Budget_accountBookId_fkey" FOREIGN KEY ("accountBookId") REFERENCES "AccountBook" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Budget_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Budget" ("accountBookId", "amount", "categoryCode", "createdAt", "endDate", "id", "month", "name", "remark", "startDate", "tags", "type", "updatedAt", "year") SELECT "accountBookId", "amount", "categoryCode", "createdAt", "endDate", "id", "month", "name", "remark", "startDate", "tags", "type", "updatedAt", "year" FROM "Budget";
DROP TABLE "Budget";
ALTER TABLE "new_Budget" RENAME TO "Budget";
CREATE INDEX "Budget_accountBookId_year_month_idx" ON "Budget"("accountBookId", "year", "month");
CREATE INDEX "Budget_accountBookId_ownerId_idx" ON "Budget"("accountBookId", "ownerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

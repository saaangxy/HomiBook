-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserProviderConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL DEFAULT '',
    "baseURL" TEXT NOT NULL DEFAULT '',
    "models" TEXT NOT NULL DEFAULT '',
    "temperature" REAL,
    "maxTokens" INTEGER,
    "contextWindow" INTEGER,
    "testStatus" TEXT NOT NULL DEFAULT 'untested',
    "lastTestedAt" DATETIME,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "multimodal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserProviderConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UserProviderConfig" ("apiKey", "baseURL", "contextWindow", "createdAt", "id", "lastTestedAt", "maxTokens", "models", "name", "provider", "sortOrder", "temperature", "testStatus", "updatedAt", "userId") SELECT "apiKey", "baseURL", "contextWindow", "createdAt", "id", "lastTestedAt", "maxTokens", "models", "name", "provider", "sortOrder", "temperature", "testStatus", "updatedAt", "userId" FROM "UserProviderConfig";
DROP TABLE "UserProviderConfig";
ALTER TABLE "new_UserProviderConfig" RENAME TO "UserProviderConfig";
CREATE INDEX "UserProviderConfig_userId_idx" ON "UserProviderConfig"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

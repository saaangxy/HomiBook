-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "theme" TEXT NOT NULL DEFAULT 'dark',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);

-- CreateTable
CREATE TABLE "AccountBook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AccountBook_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AccountBookMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountBookId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountBookMember_accountBookId_fkey" FOREIGN KEY ("accountBookId") REFERENCES "AccountBook" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AccountBookMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountBookId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "initialBalance" REAL NOT NULL DEFAULT 0,
    "balance" REAL NOT NULL DEFAULT 0,
    "balanceAt" DATETIME,
    "accountNo" TEXT,
    "bankName" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Account_accountBookId_fkey" FOREIGN KEY ("accountBookId") REFERENCES "AccountBook" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Account_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BalanceAdjustment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "amount" REAL NOT NULL,
    "balanceBefore" REAL NOT NULL,
    "balanceAfter" REAL NOT NULL,
    "remark" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BalanceAdjustment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Record" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountBookId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "date" DATETIME NOT NULL,
    "remark" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "accountId" TEXT NOT NULL,
    "fromAccountId" TEXT,
    "toAccountId" TEXT,
    "categoryCode" TEXT,
    "payer" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Record_accountBookId_fkey" FOREIGN KEY ("accountBookId") REFERENCES "AccountBook" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Record_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Record_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Record_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Record_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecordAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recordId" TEXT,
    "path" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecordAttachment_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "Record" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShareCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountBookId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShareCode_accountBookId_fkey" FOREIGN KEY ("accountBookId") REFERENCES "AccountBook" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Dictionary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "group" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "isWorkday" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountBookId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" REAL NOT NULL,
    "categoryCode" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "startDate" DATETIME,
    "endDate" DATETIME,
    "remark" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Budget_accountBookId_fkey" FOREIGN KEY ("accountBookId") REFERENCES "AccountBook" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecurringTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountBookId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "remark" TEXT,
    "tags" TEXT NOT NULL DEFAULT '["固定收支"]',
    "accountId" TEXT NOT NULL,
    "toAccountId" TEXT,
    "categoryCode" TEXT,
    "payer" TEXT,
    "ownerId" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "recurringType" TEXT NOT NULL,
    "loanTotalAmount" REAL,
    "loanRemainingAmount" REAL,
    "loanInterestRate" REAL,
    "loanInterestMethod" TEXT,
    "loanStartDate" DATETIME,
    "loanTermMonths" INTEGER,
    "loanMonthlyPayment" REAL,
    "lastGeneratedAt" DATETIME,
    "nextGenerateAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RecurringTransaction_accountBookId_fkey" FOREIGN KEY ("accountBookId") REFERENCES "AccountBook" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RecurringTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecurringTransaction_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "RecurringTransaction_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RepaymentPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recurringTransactionId" TEXT NOT NULL,
    "period" INTEGER NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "totalPayment" REAL NOT NULL,
    "principal" REAL NOT NULL,
    "interest" REAL NOT NULL,
    "remainingPrincipal" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "generatedRecordId" TEXT,
    CONSTRAINT "RepaymentPlan_recurringTransactionId_fkey" FOREIGN KEY ("recurringTransactionId") REFERENCES "RecurringTransaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportAccountMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "sourceAccountName" TEXT NOT NULL,
    "payerContains" TEXT NOT NULL DEFAULT '',
    "descriptionContains" TEXT NOT NULL DEFAULT '',
    "targetAccountName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ImportCategoryMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "sourceCategory" TEXT NOT NULL,
    "payerContains" TEXT NOT NULL DEFAULT '',
    "descriptionContains" TEXT NOT NULL DEFAULT '',
    "recordType" TEXT NOT NULL DEFAULT '',
    "targetCategoryCode" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "lastUsedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accountBookId" TEXT,
    "title" TEXT NOT NULL DEFAULT '新对话',
    "summary" TEXT,
    "summaryUpToMessageId" TEXT,
    "modelProvider" TEXT NOT NULL DEFAULT 'deepseek',
    "modelName" TEXT NOT NULL DEFAULT 'deepseek-chat',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatSession_accountBookId_fkey" FOREIGN KEY ("accountBookId") REFERENCES "AccountBook" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "accountBookId" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" TEXT,
    "tokenCount" INTEGER NOT NULL DEFAULT 0,
    "modelProvider" TEXT,
    "modelName" TEXT,
    "parentMessageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChatMessage_accountBookId_fkey" FOREIGN KEY ("accountBookId") REFERENCES "AccountBook" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserMemory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "content" TEXT NOT NULL,
    "keywords" TEXT,
    "memoryType" TEXT NOT NULL DEFAULT 'extracted',
    "importance" REAL NOT NULL DEFAULT 0.5,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserMemory_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "toolName" TEXT,
    "input" TEXT,
    "output" TEXT,
    "modelProvider" TEXT,
    "modelName" TEXT,
    "durationMs" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'success',
    "errorMessage" TEXT,
    "ip" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentAuditLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AgentAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserAIConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "simpleProviderConfigId" TEXT,
    "simpleModel" TEXT NOT NULL DEFAULT 'deepseek-chat',
    "complexProviderConfigId" TEXT,
    "complexModel" TEXT NOT NULL DEFAULT 'deepseek-reasoner',
    "autoConfirmCreate" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'zh-CN',
    "temperature" REAL NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER NOT NULL DEFAULT 4096,
    "maxSteps" INTEGER NOT NULL DEFAULT 10,
    "visionProviderConfigId" TEXT,
    "visionModel" TEXT NOT NULL DEFAULT '',
    "disabledTools" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserAIConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserProviderConfig" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserProviderConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "AccountBookMember_accountBookId_userId_key" ON "AccountBookMember"("accountBookId", "userId");

-- CreateIndex
CREATE INDEX "Record_accountBookId_date_idx" ON "Record"("accountBookId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ShareCode_code_key" ON "ShareCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "SystemConfig_key_key" ON "SystemConfig"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Dictionary_group_code_key" ON "Dictionary"("group", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_key" ON "Holiday"("date");

-- CreateIndex
CREATE INDEX "Budget_accountBookId_year_month_idx" ON "Budget"("accountBookId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_accountBookId_type_year_month_name_key" ON "Budget"("accountBookId", "type", "year", "month", "name");

-- CreateIndex
CREATE INDEX "RepaymentPlan_recurringTransactionId_idx" ON "RepaymentPlan"("recurringTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportAccountMapping_source_sourceAccountName_payerContains_descriptionContains_key" ON "ImportAccountMapping"("source", "sourceAccountName", "payerContains", "descriptionContains");

-- CreateIndex
CREATE UNIQUE INDEX "ImportCategoryMapping_source_sourceCategory_payerContains_descriptionContains_recordType_key" ON "ImportCategoryMapping"("source", "sourceCategory", "payerContains", "descriptionContains", "recordType");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_hash_key" ON "ApiKey"("hash");

-- CreateIndex
CREATE INDEX "ChatSession_userId_updatedAt_idx" ON "ChatSession"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "UserMemory_userId_memoryType_idx" ON "UserMemory"("userId", "memoryType");

-- CreateIndex
CREATE INDEX "UserMemory_userId_lastAccessedAt_idx" ON "UserMemory"("userId", "lastAccessedAt");

-- CreateIndex
CREATE INDEX "AgentAuditLog_userId_createdAt_idx" ON "AgentAuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentAuditLog_sessionId_createdAt_idx" ON "AgentAuditLog"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserAIConfig_userId_key" ON "UserAIConfig"("userId");

-- CreateIndex
CREATE INDEX "UserProviderConfig_userId_idx" ON "UserProviderConfig"("userId");


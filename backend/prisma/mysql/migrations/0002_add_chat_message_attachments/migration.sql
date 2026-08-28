-- AI 聊天消息附件关联表：持久化聊天中发送的图片/文件与消息的关联，
-- 用于历史会话回显附件，并防止孤儿附件清理误删聊天仍在使用的文件
CREATE TABLE `ChatMessageAttachment` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `attachmentId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ChatMessageAttachment_messageId_idx`(`messageId`),
    INDEX `ChatMessageAttachment_attachmentId_idx`(`attachmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ChatMessageAttachment` ADD CONSTRAINT `ChatMessageAttachment_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `ChatMessage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChatMessageAttachment` ADD CONSTRAINT `ChatMessageAttachment_attachmentId_fkey` FOREIGN KEY (`attachmentId`) REFERENCES `RecordAttachment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

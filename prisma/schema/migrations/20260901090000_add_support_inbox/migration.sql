-- CreateEnum
CREATE TYPE "SupportChannel" AS ENUM ('WINDEE', 'MESSENGER', 'WHATSAPP', 'INSTAGRAM', 'EMAIL', 'COMMENTS');

-- CreateEnum
CREATE TYPE "SupportConversationStatus" AS ENUM ('IN_QUEUE', 'WITH_AGENT', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SupportAgentPresence" AS ENUM ('AVAILABLE', 'BUSY', 'AWAY', 'OFFLINE');

-- CreateEnum
CREATE TYPE "SupportMessageAuthor" AS ENUM ('CUSTOMER', 'AGENT', 'BOT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SupportEventType" AS ENUM ('CREATED', 'QUEUED', 'ASSIGNED', 'TRANSFERRED', 'PRIORITY_CHANGED', 'TAGGED', 'UNTAGGED', 'CLOSED', 'REOPENED');

-- CreateTable
CREATE TABLE "support_agents" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "presence" "SupportAgentPresence" NOT NULL DEFAULT 'OFFLINE',
    "maxConcurrent" INTEGER NOT NULL DEFAULT 5,
    "title" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_queues" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_queues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_contacts" (
    "id" TEXT NOT NULL,
    "channel" "SupportChannel" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "avatarUrl" TEXT,
    "locale" TEXT,
    "location" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_conversations" (
    "id" TEXT NOT NULL,
    "ticketNo" TEXT NOT NULL,
    "channel" "SupportChannel" NOT NULL,
    "status" "SupportConversationStatus" NOT NULL DEFAULT 'IN_QUEUE',
    "priority" "SupportPriority" NOT NULL DEFAULT 'MEDIUM',
    "contactId" TEXT NOT NULL,
    "queueId" TEXT,
    "assignedAgentId" TEXT,
    "chatSessionId" TEXT,
    "externalId" TEXT,
    "subject" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessagePreview" TEXT NOT NULL DEFAULT '',
    "unreadForAgent" INTEGER NOT NULL DEFAULT 0,
    "firstResponseAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "author" "SupportMessageAuthor" NOT NULL,
    "agentId" TEXT,
    "body" TEXT NOT NULL,
    "attachments" JSONB,
    "isInternalNote" BOOLEAN NOT NULL DEFAULT false,
    "externalId" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "deliveryError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_events" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "type" "SupportEventType" NOT NULL,
    "actorId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_conversation_tags" (
    "conversationId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_conversation_tags_pkey" PRIMARY KEY ("conversationId","tagId")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_agents_userId_key" ON "support_agents"("userId");

-- CreateIndex
CREATE INDEX "support_agents_presence_idx" ON "support_agents"("presence");

-- CreateIndex
CREATE UNIQUE INDEX "support_queues_name_key" ON "support_queues"("name");

-- CreateIndex
CREATE UNIQUE INDEX "support_queues_slug_key" ON "support_queues"("slug");

-- CreateIndex
CREATE INDEX "support_contacts_userId_idx" ON "support_contacts"("userId");

-- CreateIndex
CREATE INDEX "support_contacts_phone_idx" ON "support_contacts"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "support_contacts_channel_externalId_key" ON "support_contacts"("channel", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "support_conversations_ticketNo_key" ON "support_conversations"("ticketNo");

-- CreateIndex
CREATE UNIQUE INDEX "support_conversations_chatSessionId_key" ON "support_conversations"("chatSessionId");

-- CreateIndex
CREATE INDEX "support_conversations_status_lastMessageAt_idx" ON "support_conversations"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "support_conversations_channel_status_idx" ON "support_conversations"("channel", "status");

-- CreateIndex
CREATE INDEX "support_conversations_queueId_status_idx" ON "support_conversations"("queueId", "status");

-- CreateIndex
CREATE INDEX "support_conversations_assignedAgentId_status_idx" ON "support_conversations"("assignedAgentId", "status");

-- CreateIndex
CREATE INDEX "support_conversations_contactId_idx" ON "support_conversations"("contactId");

-- CreateIndex
CREATE INDEX "support_conversations_externalId_idx" ON "support_conversations"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "support_messages_externalId_key" ON "support_messages"("externalId");

-- CreateIndex
CREATE INDEX "support_messages_conversationId_createdAt_idx" ON "support_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "support_events_conversationId_createdAt_idx" ON "support_events"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "support_tags_name_key" ON "support_tags"("name");

-- AddForeignKey
ALTER TABLE "support_agents" ADD CONSTRAINT "support_agents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_contacts" ADD CONSTRAINT "support_contacts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "support_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "support_queues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES "support_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_chatSessionId_fkey" FOREIGN KEY ("chatSessionId") REFERENCES "chat_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "support_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "support_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_events" ADD CONSTRAINT "support_events_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_events" ADD CONSTRAINT "support_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "support_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_conversation_tags" ADD CONSTRAINT "support_conversation_tags_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_conversation_tags" ADD CONSTRAINT "support_conversation_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "support_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;


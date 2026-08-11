CREATE SCHEMA IF NOT EXISTS "public";
CREATE TYPE "ChatType" AS ENUM ('DIRECT', 'GROUP');
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "MessageKind" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'FILE', 'SYSTEM');
CREATE TYPE "VoiceParticipantState" AS ENUM ('JOINED', 'LEFT');
CREATE TABLE "User" (
    "id" TEXT NOT NULL, "email" TEXT NOT NULL, "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL, "passwordHash" TEXT NOT NULL, "avatarUrl" TEXT,
    "bio" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Chat" (
    "id" TEXT NOT NULL, "type" "ChatType" NOT NULL, "title" TEXT, "avatarUrl" TEXT,
    "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ChatMember" (
    "chatId" TEXT NOT NULL, "userId" TEXT NOT NULL, "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastReadAt" TIMESTAMP(3),
    "mutedUntil" TIMESTAMP(3), CONSTRAINT "ChatMember_pkey" PRIMARY KEY ("chatId","userId")
);
CREATE TABLE "Message" (
    "id" TEXT NOT NULL, "chatId" TEXT NOT NULL, "authorId" TEXT NOT NULL,
    "kind" "MessageKind" NOT NULL DEFAULT 'TEXT', "body" TEXT NOT NULL, "mediaUrl" TEXT,
    "mediaName" TEXT, "replyToId" TEXT, "editedAt" TIMESTAMP(3), "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "MessageReaction" (
    "messageId" TEXT NOT NULL, "userId" TEXT NOT NULL, "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("messageId","userId","emoji")
);
CREATE TABLE "VoiceRoom" (
    "id" TEXT NOT NULL, "chatId" TEXT NOT NULL, "livekitRoomName" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "endedAt" TIMESTAMP(3),
    CONSTRAINT "VoiceRoom_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "VoiceRoomParticipant" (
    "id" TEXT NOT NULL, "roomId" TEXT NOT NULL, "userId" TEXT NOT NULL,
    "state" "VoiceParticipantState" NOT NULL DEFAULT 'JOINED',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "leftAt" TIMESTAMP(3),
    "isMuted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "VoiceRoomParticipant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "Chat_updatedAt_idx" ON "Chat"("updatedAt");
CREATE INDEX "ChatMember_userId_idx" ON "ChatMember"("userId");
CREATE INDEX "Message_chatId_createdAt_idx" ON "Message"("chatId", "createdAt");
CREATE UNIQUE INDEX "VoiceRoom_livekitRoomName_key" ON "VoiceRoom"("livekitRoomName");
CREATE INDEX "VoiceRoomParticipant_roomId_state_idx" ON "VoiceRoomParticipant"("roomId", "state");
ALTER TABLE "Chat" ADD CONSTRAINT "Chat_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMember" ADD CONSTRAINT "ChatMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoiceRoom" ADD CONSTRAINT "VoiceRoom_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoiceRoomParticipant" ADD CONSTRAINT "VoiceRoomParticipant_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "VoiceRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoiceRoomParticipant" ADD CONSTRAINT "VoiceRoomParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

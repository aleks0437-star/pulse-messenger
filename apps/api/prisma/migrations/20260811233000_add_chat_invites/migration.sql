ALTER TABLE "ChatMember" ADD COLUMN "isMuted" BOOLEAN NOT NULL DEFAULT false;
UPDATE "ChatMember" SET "isMuted" = true WHERE "mutedUntil" IS NOT NULL;

CREATE TABLE "ChatInvite" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usesCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatInvite_code_key" ON "ChatInvite"("code");
CREATE INDEX "ChatInvite_chatId_revokedAt_idx" ON "ChatInvite"("chatId", "revokedAt");
ALTER TABLE "ChatInvite" ADD CONSTRAINT "ChatInvite_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatInvite" ADD CONSTRAINT "ChatInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

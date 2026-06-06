-- 2026-06-06: difusión interna para equipos de ventas (item 14 sprint).
--
-- SUPER_ADMIN puede crear banners + popups dirigidos a embajadores /
-- influencers / vendedores. La regla "una sola vez por user" para los
-- popups se cumple con BroadcastRead (unique broadcastId+userId): el
-- endpoint público filtra los que el user todavía no leyó.

-- CreateEnum
CREATE TYPE "BroadcastKind" AS ENUM ('BANNER', 'LOGIN_POPUP');

-- CreateEnum
CREATE TYPE "BroadcastAudience" AS ENUM ('ALL', 'INFLUENCERS', 'AMBASSADORS', 'VENDORS');

-- CreateEnum
CREATE TYPE "BroadcastColor" AS ENUM ('GREEN', 'BLUE', 'YELLOW', 'RED', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BroadcastIcon" AS ENUM ('INFO', 'ALERT', 'NEWS', 'TRAINING', 'PROMO');

-- CreateEnum
CREATE TYPE "BroadcastMediaKind" AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO', 'PDF');

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "kind" "BroadcastKind" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "audience" "BroadcastAudience" NOT NULL DEFAULT 'ALL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "color" "BroadcastColor",
    "customColor" TEXT,
    "icon" "BroadcastIcon",
    "ctaLabel" TEXT,
    "ctaUrl" TEXT,
    "mediaKind" "BroadcastMediaKind",
    "mediaUrl" TEXT,
    "confirmLabel" TEXT DEFAULT 'He leído',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastRead" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Broadcast_kind_isActive_idx" ON "Broadcast"("kind", "isActive");

-- CreateIndex
CREATE INDEX "Broadcast_audience_idx" ON "Broadcast"("audience");

-- CreateIndex
CREATE INDEX "BroadcastRead_userId_idx" ON "BroadcastRead"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastRead_broadcastId_userId_key" ON "BroadcastRead"("broadcastId", "userId");

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRead" ADD CONSTRAINT "BroadcastRead_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRead" ADD CONSTRAINT "BroadcastRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

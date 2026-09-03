-- Cuponera Fase 5: sellos comunitarios (StampProgram, StampCard, StampEvent).

-- CreateEnum
CREATE TYPE "StampProgramStatus" AS ENUM ('ACTIVE', 'PAUSED');
CREATE TYPE "StampEventAction" AS ENUM ('STAMP', 'REDEEM');

-- CreateTable
CREATE TABLE "StampProgram" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "categoryId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT,
    "stampsRequired" INTEGER NOT NULL DEFAULT 5,
    "rewardText" TEXT NOT NULL DEFAULT '',
    "maxPerDay" INTEGER NOT NULL DEFAULT 1,
    "status" "StampProgramStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StampProgram_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StampProgram_campaignId_status_idx" ON "StampProgram"("campaignId", "status");
CREATE INDEX "StampProgram_categoryId_idx" ON "StampProgram"("categoryId");

-- CreateTable
CREATE TABLE "StampCard" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "stampsCount" INTEGER NOT NULL DEFAULT 0,
    "cyclesCompleted" INTEGER NOT NULL DEFAULT 0,
    "lastStampAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StampCard_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StampCard_programId_customerId_key" ON "StampCard"("programId", "customerId");
CREATE INDEX "StampCard_customerId_idx" ON "StampCard"("customerId");

-- CreateTable
CREATE TABLE "StampEvent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "allyBusinessId" TEXT,
    "operatorUserId" TEXT,
    "action" "StampEventAction" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StampEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StampEvent_programId_customerId_createdAt_idx" ON "StampEvent"("programId", "customerId", "createdAt");
CREATE INDEX "StampEvent_allyBusinessId_createdAt_idx" ON "StampEvent"("allyBusinessId", "createdAt");

-- AddForeignKey
ALTER TABLE "StampProgram" ADD CONSTRAINT "StampProgram_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StampProgram" ADD CONSTRAINT "StampProgram_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BenefitCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StampCard" ADD CONSTRAINT "StampCard_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StampCard" ADD CONSTRAINT "StampCard_programId_fkey" FOREIGN KEY ("programId") REFERENCES "StampProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StampCard" ADD CONSTRAINT "StampCard_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StampEvent" ADD CONSTRAINT "StampEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StampEvent" ADD CONSTRAINT "StampEvent_programId_fkey" FOREIGN KEY ("programId") REFERENCES "StampProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StampEvent" ADD CONSTRAINT "StampEvent_allyBusinessId_fkey" FOREIGN KEY ("allyBusinessId") REFERENCES "AllyBusiness"("id") ON DELETE SET NULL ON UPDATE CASCADE;

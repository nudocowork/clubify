-- Cuponera Fase 2: negocios aliados (AllyBusiness) + User.allyBusinessId.

-- CreateEnum
CREATE TYPE "AllyStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "allyBusinessId" TEXT;

-- CreateTable
CREATE TABLE "AllyBusiness" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "categoryId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "logoUrl" TEXT,
    "coverUrl" TEXT,
    "photos" JSONB NOT NULL DEFAULT '[]',
    "address" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "hours" JSONB NOT NULL DEFAULT '{}',
    "whatsapp" TEXT,
    "instagram" TEXT,
    "website" TEXT,
    "status" "AllyStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AllyBusiness_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AllyBusiness_slug_key" ON "AllyBusiness"("slug");
CREATE INDEX "AllyBusiness_campaignId_status_idx" ON "AllyBusiness"("campaignId", "status");
CREATE INDEX "AllyBusiness_categoryId_idx" ON "AllyBusiness"("categoryId");

-- CreateIndex
CREATE INDEX "User_allyBusinessId_idx" ON "User"("allyBusinessId");

-- AddForeignKey
ALTER TABLE "AllyBusiness" ADD CONSTRAINT "AllyBusiness_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "BenefitCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AllyBusiness" ADD CONSTRAINT "AllyBusiness_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "BenefitCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_allyBusinessId_fkey" FOREIGN KEY ("allyBusinessId") REFERENCES "AllyBusiness"("id") ON DELETE SET NULL ON UPDATE CASCADE;

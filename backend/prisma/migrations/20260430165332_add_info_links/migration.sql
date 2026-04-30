-- CreateTable
CREATE TABLE "InfoLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "heroImageUrl" TEXT,
    "gallery" JSONB NOT NULL DEFAULT '[]',
    "sections" JSONB NOT NULL DEFAULT '[]',
    "buttons" JSONB NOT NULL DEFAULT '[]',
    "theme" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfoLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfoLinkEvent" (
    "id" TEXT NOT NULL,
    "infoLinkId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InfoLinkEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InfoLink_tenantId_isActive_idx" ON "InfoLink"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "InfoLink_tenantId_slug_key" ON "InfoLink"("tenantId", "slug");

-- CreateIndex
CREATE INDEX "InfoLinkEvent_infoLinkId_type_createdAt_idx" ON "InfoLinkEvent"("infoLinkId", "type", "createdAt");

-- AddForeignKey
ALTER TABLE "InfoLink" ADD CONSTRAINT "InfoLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfoLinkEvent" ADD CONSTRAINT "InfoLinkEvent_infoLinkId_fkey" FOREIGN KEY ("infoLinkId") REFERENCES "InfoLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

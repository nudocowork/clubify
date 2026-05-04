-- Order rating: 1-5 stars + optional comment + when it was rated
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "rating" INTEGER;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "ratingComment" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "ratedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Order_tenantId_ratedAt_idx" ON "Order"("tenantId", "ratedAt");

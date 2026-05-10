// Fase 3 de Referidos: Cupones + uses.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const sql = [
  `DO $$ BEGIN
     CREATE TYPE "CouponStatus" AS ENUM ('ACTIVE','PAUSED','EXPIRED');
   EXCEPTION WHEN duplicate_object THEN null; END $$`,
  `DO $$ BEGIN
     CREATE TYPE "CouponDuration" AS ENUM ('FIRST_MONTH','RECURRING');
   EXCEPTION WHEN duplicate_object THEN null; END $$`,

  `CREATE TABLE IF NOT EXISTS "Coupon" (
     "id" TEXT NOT NULL PRIMARY KEY,
     "code" TEXT NOT NULL UNIQUE,
     "discountPercent" DECIMAL(5,2) NOT NULL,
     "validFrom" TIMESTAMP(3),
     "validUntil" TIMESTAMP(3),
     "maxUses" INTEGER,
     "useCount" INTEGER NOT NULL DEFAULT 0,
     "applicablePlans" TEXT NOT NULL DEFAULT '',
     "duration" "CouponDuration" NOT NULL DEFAULT 'FIRST_MONTH',
     "status" "CouponStatus" NOT NULL DEFAULT 'ACTIVE',
     "referralCodeId" TEXT,
     "campaignId" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,

  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                    WHERE constraint_name = 'Coupon_referralCodeId_fkey') THEN
       ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_referralCodeId_fkey"
         FOREIGN KEY ("referralCodeId") REFERENCES "ReferralCode"("id") ON DELETE SET NULL;
     END IF;
   END $$`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                    WHERE constraint_name = 'Coupon_campaignId_fkey') THEN
       ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_campaignId_fkey"
         FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL;
     END IF;
   END $$`,

  `CREATE INDEX IF NOT EXISTS "Coupon_referralCodeId_idx" ON "Coupon"("referralCodeId")`,
  `CREATE INDEX IF NOT EXISTS "Coupon_campaignId_idx" ON "Coupon"("campaignId")`,
  `CREATE INDEX IF NOT EXISTS "Coupon_status_idx" ON "Coupon"("status")`,

  `CREATE TABLE IF NOT EXISTS "CouponUse" (
     "id" TEXT NOT NULL PRIMARY KEY,
     "couponId" TEXT NOT NULL,
     "tenantId" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,

  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                    WHERE constraint_name = 'CouponUse_couponId_fkey') THEN
       ALTER TABLE "CouponUse" ADD CONSTRAINT "CouponUse_couponId_fkey"
         FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE;
     END IF;
   END $$`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                    WHERE constraint_name = 'CouponUse_tenantId_fkey') THEN
       ALTER TABLE "CouponUse" ADD CONSTRAINT "CouponUse_tenantId_fkey"
         FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL;
     END IF;
   END $$`,

  `CREATE INDEX IF NOT EXISTS "CouponUse_couponId_idx" ON "CouponUse"("couponId")`,
  `CREATE INDEX IF NOT EXISTS "CouponUse_tenantId_idx" ON "CouponUse"("tenantId")`,
];

for (const q of sql) {
  await prisma.$executeRawUnsafe(q);
}
console.log('OK', sql.length, 'statements applied');
await prisma.$disconnect();

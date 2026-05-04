-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "failedPaymentCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hotmartSubscriberCode" TEXT,
ADD COLUMN     "hotmartTransactionId" TEXT,
ADD COLUMN     "lastPaymentAttemptAt" TIMESTAMP(3),
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "trialEndsAt" TIMESTAMP(3),
ADD COLUMN     "trialStartedAt" TIMESTAMP(3);

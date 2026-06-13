-- HotmartCreditLink: productId + offerCode + relación inversa
ALTER TABLE "HotmartCreditLink" ADD COLUMN "productId" TEXT;
ALTER TABLE "HotmartCreditLink" ADD COLUMN "offerCode" TEXT;
CREATE INDEX "HotmartCreditLink_productId_idx" ON "HotmartCreditLink"("productId");

-- Auditoría de compras concretadas
CREATE TABLE "HotmartCreditPurchase" (
  "id" TEXT NOT NULL,
  "linkId" TEXT,
  "whiteLabelId" TEXT,
  "buyerEmail" TEXT NOT NULL,
  "productId" TEXT,
  "offerCode" TEXT,
  "credits" INTEGER NOT NULL,
  "amount" DECIMAL(12,2),
  "currency" TEXT NOT NULL DEFAULT 'MXN',
  "transactionId" TEXT NOT NULL,
  "rawPayload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HotmartCreditPurchase_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HotmartCreditPurchase_transactionId_key" ON "HotmartCreditPurchase"("transactionId");
CREATE INDEX "HotmartCreditPurchase_whiteLabelId_createdAt_idx" ON "HotmartCreditPurchase"("whiteLabelId", "createdAt");
CREATE INDEX "HotmartCreditPurchase_buyerEmail_idx" ON "HotmartCreditPurchase"("buyerEmail");
ALTER TABLE "HotmartCreditPurchase" ADD CONSTRAINT "HotmartCreditPurchase_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "HotmartCreditLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

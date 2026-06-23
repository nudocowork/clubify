-- Distinguir packs de créditos (1/10/20) que comparten el mismo hotmartProductId
-- pero difieren por oferta. El webhook matchea por (productId + offerCode).
ALTER TABLE "HotmartCreditLink" ADD COLUMN IF NOT EXISTS "hotmartOfferCode" TEXT;

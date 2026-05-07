-- Logo específico para tarjetas wallet (Apple/Google). Si null, fallback a logoUrl.
ALTER TABLE "Tenant" ADD COLUMN "walletLogoUrl" TEXT;

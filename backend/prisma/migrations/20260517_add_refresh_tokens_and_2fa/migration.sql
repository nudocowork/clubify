-- RefreshToken: rotation + revocation + token family para reuse detection.
-- Cada login crea una family nueva; cada refresh rota dentro de la misma
-- family. Si un token YA rotado se intenta usar, la family entera se revoca.
CREATE TABLE "RefreshToken" (
  "id"                TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "tokenHash"         TEXT NOT NULL,
  "familyId"          TEXT NOT NULL,
  "expiresAt"         TIMESTAMP(3) NOT NULL,
  "revokedAt"         TIMESTAMP(3),
  "replacedByTokenId" TEXT,
  "ip"                TEXT,
  "userAgent"         TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

ALTER TABLE "RefreshToken"
  ADD CONSTRAINT "RefreshToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- User: 2FA TOTP (obligatorio en SUPER_ADMIN, opcional en otros roles) y
-- timestamp para invalidar todos los refresh emitidos antes del último
-- cambio de contraseña.
ALTER TABLE "User" ADD COLUMN "totpSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "totpEnabledAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

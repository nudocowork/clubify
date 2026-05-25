-- F4 backfill: re-backfill de slug en ReferralCode para filas que se
-- crearon DESPUÉS de la migration original 20260522 sin recibir slug
-- (los paths affiliate/campaigns/ambassador crean rows sin setear slug
-- — fix code-side incluido en el mismo PR para preventir nuevos).
--
-- Idempotente: solo toca filas con slug IS NULL. Si la UNIQUE constraint
-- choca (porque LOWER(code) ya está usado por otro row), el row queda
-- con slug=null — el F4 fallback al code resuelve igual el /ref/<x>.

UPDATE "ReferralCode"
SET "slug" = LOWER("code")
WHERE "slug" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ReferralCode" r2
    WHERE r2."slug" = LOWER("ReferralCode"."code")
  );

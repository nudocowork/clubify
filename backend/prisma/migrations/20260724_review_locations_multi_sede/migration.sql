-- Multi-sede para reseñas (2026-06-06).
--
-- Negocios con varias ubicaciones (cadenas, franquicias) necesitan
-- diferenciar el destino del rating positivo según la sede. El modelo
-- existente ReviewQrTarget (M7.3) ya cubre el caso por QR específico
-- pero faltaba (1) address legible para mostrar al cliente en el selector
-- y (2) position para drag-and-drop en el admin + orden estable en el
-- selector del /r/<slug>.

ALTER TABLE "ReviewQrTarget" ADD COLUMN "address" TEXT;
ALTER TABLE "ReviewQrTarget" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

-- Inicializamos position en orden de creación para los registros existentes
-- (sino todos quedan en 0 y el orden visible sería arbitrario).
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "tenantId" ORDER BY "createdAt") - 1 AS rn
  FROM "ReviewQrTarget"
)
UPDATE "ReviewQrTarget" t
SET "position" = o.rn
FROM ordered o
WHERE t.id = o.id;

CREATE INDEX "ReviewQrTarget_tenantId_isActive_position_idx"
  ON "ReviewQrTarget"("tenantId", "isActive", "position");

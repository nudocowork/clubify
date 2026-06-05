-- M4 (2026-06-04): override del límite "1 sello cada 24h" por tenant.
-- Null = 1 (default histórico). Cualquier número >= 1 permite N sellos
-- por pass por día. Pensado para campañas promocionales (ej: cumpleaños,
-- evento, doble sello hoy). El bypass SUPER_ADMIN sigue intacto.
ALTER TABLE "Tenant" ADD COLUMN "maxStampsPerDay" INTEGER;

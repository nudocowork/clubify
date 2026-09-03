-- Notas internas del negocio (SOLO Clubify: /admin/tenants/[id]). Aditivo, nullable.
ALTER TABLE "Tenant" ADD COLUMN "notes" TEXT;

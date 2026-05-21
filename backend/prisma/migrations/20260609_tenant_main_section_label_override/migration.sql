-- Override per-tenant del nombre visible de la sección principal del panel
-- y de la vista pública ("Menú" → "Servicios", "Tratamientos", etc).
-- Si null, se usa el label inferido de businessCategorySlug (default "Menú").
ALTER TABLE "Tenant" ADD COLUMN "mainSectionLabelOverride" TEXT;

-- Categoría del rubro del negocio (restaurante, autolavado, barbería, etc).
-- Define qué módulos ve el dueño en su panel. Lista en
-- backend/src/common/business-categories.ts.
ALTER TABLE "Tenant" ADD COLUMN "businessCategorySlug" TEXT;

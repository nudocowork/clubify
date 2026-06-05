-- Periodicidad del plan del tenant (MENSUAL/TRIMESTRAL/SEMESTRAL/ANUAL).
-- Informativo: NO cambia comportamiento de billing — el ciclo real lo dicta
-- Hotmart (currentPeriodEnd + hotmartSubscriberCode). Sirve para CRM,
-- reporting y filtros en /admin/tenants. Editable por SUPER_ADMIN.
ALTER TABLE "Tenant" ADD COLUMN "planPeriodicity" TEXT;

-- Días de gracia post-trial configurables por tenant (editable super admin).
-- Default 0 = corte duro al expirar trialEndsAt (comportamiento previo).
ALTER TABLE "Tenant" ADD COLUMN "gracePeriodDays" INTEGER NOT NULL DEFAULT 0;

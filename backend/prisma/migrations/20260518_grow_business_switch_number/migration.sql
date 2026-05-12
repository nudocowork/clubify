-- Tenant.growBusinessSwitchNumber: identificador del sub-account en
-- workflows de GHL. Se prepone al body de cada SMS saliente como
-- "#Switch{N}\n\n" para que el workflow de GHL pueda enrutar al canal
-- correcto. Null = no se prepone prefijo (mensaje plano).
ALTER TABLE "Tenant" ADD COLUMN "growBusinessSwitchNumber" INTEGER;

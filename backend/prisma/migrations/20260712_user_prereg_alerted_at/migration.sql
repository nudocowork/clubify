-- Fase E: dedup de alertas SMS de preregistro. Marca cuándo se envió
-- la alerta al equipo (Javier/Jhon). null = sin alerta enviada.

ALTER TABLE "User" ADD COLUMN "preregAlertedAt" TIMESTAMP(3);

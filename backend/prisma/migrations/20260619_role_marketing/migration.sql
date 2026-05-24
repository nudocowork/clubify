-- Rol MARKETING: usuario global con acceso solo a marketing/diseño
-- en todos los negocios. Sin scanner, sin financiero, sin crear negocios.
-- IF NOT EXISTS es idempotente — seguro de reaplicar.

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MARKETING';

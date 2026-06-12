-- F (2026-06-12): agregar VENDOR y ALL al enum SupportMaterialAudience.
-- VENDOR = material específico para vendors del embajador.
-- ALL = visible para INFLUENCER/AMBASSADOR/VENDOR.

ALTER TYPE "SupportMaterialAudience" ADD VALUE IF NOT EXISTS 'VENDOR';
ALTER TYPE "SupportMaterialAudience" ADD VALUE IF NOT EXISTS 'ALL';

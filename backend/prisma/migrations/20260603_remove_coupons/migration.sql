-- Eliminar sistema completo de cupones de descuento.
-- Decisión 2026-06-03: los cupones nunca aplicaban descuento real en
-- Hotmart (eran trackeo interno solamente). Para evitar prometerle al
-- cliente un descuento que no recibía, removemos todo el sistema.
--
-- - Tablas Coupon + CouponUse (cascade los CouponUse al drop de Coupon)
-- - Enums CouponDuration + CouponStatus
-- - Columna Campaign.discountAbsorption (sin cupones no hay descuento que
--   absorber; las comisiones siempre se calculan sobre el precio del plan)

DROP TABLE IF EXISTS "CouponUse";
DROP TABLE IF EXISTS "Coupon";
DROP TYPE IF EXISTS "CouponDuration";
DROP TYPE IF EXISTS "CouponStatus";

ALTER TABLE "Campaign" DROP COLUMN IF EXISTS "discountAbsorption";

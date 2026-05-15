-- Nuevo valor del enum AutomationEvent: COUPON_REDEEMED.
-- Disparado desde stamps.service cuando se redime un pass tipo COUPON.

ALTER TYPE "AutomationEvent" ADD VALUE IF NOT EXISTS 'COUPON_REDEEMED';

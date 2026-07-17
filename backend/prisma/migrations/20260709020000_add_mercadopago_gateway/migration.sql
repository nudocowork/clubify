-- Cuponera / Living Card: pasarela MercadoPago para membresías recurrentes.
-- Va en su PROPIA migración porque Postgres no permite USAR un valor de enum
-- recién agregado dentro de la misma transacción (la migración de tablas de
-- Cuponera lo referencia como DEFAULT en MembershipOrder.provider).
ALTER TYPE "PaymentGateway" ADD VALUE 'MERCADOPAGO';

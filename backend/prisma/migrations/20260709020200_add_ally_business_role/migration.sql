-- Cuponera Fase 2: rol de negocio aliado. En su propia migración porque
-- Postgres no permite usar un valor de enum recién agregado en la misma
-- transacción (buena práctica; aquí no se usa como default, pero mantenemos
-- el patrón por seguridad y consistencia con MERCADOPAGO).
ALTER TYPE "Role" ADD VALUE 'ALLY_BUSINESS';

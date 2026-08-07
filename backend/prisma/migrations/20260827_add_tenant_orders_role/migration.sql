-- Rol "Solo pedidos" (empleado que solo ve la sección Pedidos). Idempotente.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'TENANT_ORDERS';

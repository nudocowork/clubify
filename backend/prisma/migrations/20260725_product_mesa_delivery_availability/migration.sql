-- 2026-06-06: separación definitiva menú MESA vs DELIVERY.
--
-- Product gana 2 flags de visibilidad independientes por canal. Default true
-- a nivel de columna sirve para INSERTs nuevos; el UPDATE explícito abajo
-- garantiza que TODOS los productos preexistentes queden visibles en ambos
-- menús (mantener el comportamiento previo donde un solo menú servía a
-- los dos públicos).
--
-- Order gana un discriminator `mode` nullable. Nullable a propósito para
-- back compat con órdenes históricas — el código nuevo lo setea siempre,
-- las viejas se infieren por `fulfillment`/`deliveryAddress`.

ALTER TABLE "Product"
  ADD COLUMN "availableForMesa" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "availableForDelivery" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Product"
  SET "availableForMesa" = true,
      "availableForDelivery" = true;

ALTER TABLE "Order"
  ADD COLUMN "mode" TEXT;

-- F5.1: rutas independientes para menú digital tradicional (/m/<slug>) y
-- menú libro flipbook (/book/<slug>). Antes el `menuLayout=FLIPBOOK`
-- excluía al digital. Ahora son flags independientes.

ALTER TABLE "Storefront"
  ADD COLUMN "digitalMenuEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "bookMenuEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Backfill:
--  - Tenants con menuLayout=FLIPBOOK: tenían el flipbook visible en /m/<slug>.
--    Migran a bookMenuEnabled=true, digitalMenuEnabled=false (no rompe lo que
--    están viendo hoy — /m/<slug> redirige a /book/<slug> en frontend).
--  - Resto: digitalMenuEnabled=true (default OK), bookMenuEnabled=false hasta
--    que el dueño lo active manualmente desde /app/menu-book.
UPDATE "Storefront"
SET "bookMenuEnabled" = true,
    "digitalMenuEnabled" = false
WHERE "menuLayout" = 'FLIPBOOK';

-- Cambiamos el menuLayout=FLIPBOOK a CLASSIC para que cuando reactiven el
-- menú digital tengan un layout válido (FLIPBOOK ya no es un layout, es
-- un modo separado). El enum se mantiene con FLIPBOOK por compat — Prisma
-- no necesita migration extra.
UPDATE "Storefront"
SET "menuLayout" = 'CLASSIC'
WHERE "menuLayout" = 'FLIPBOOK';

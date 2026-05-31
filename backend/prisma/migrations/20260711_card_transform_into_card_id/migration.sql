-- Fase D: cupón → tarjeta de sellos in-place. El dueño elige al crear
-- el cupón cuál stamps card es el destino del transform al redeem.
-- null = auto (primera stamps activa, o crear).

ALTER TABLE "Card" ADD COLUMN "transformIntoCardId" TEXT;

-- SetNull: si se borra la stamps card destino, el cupón cae al modo
-- auto (no se rompe).
ALTER TABLE "Card"
  ADD CONSTRAINT "Card_transformIntoCardId_fkey"
  FOREIGN KEY ("transformIntoCardId") REFERENCES "Card"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

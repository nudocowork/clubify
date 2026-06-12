-- Product.categoryId nullable + SetNull en lugar de Cascade.
-- Permite tenants sin categorías + categories eliminadas dejan products huérfanos.
ALTER TABLE "Product" ALTER COLUMN "categoryId" DROP NOT NULL;
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_categoryId_fkey";
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

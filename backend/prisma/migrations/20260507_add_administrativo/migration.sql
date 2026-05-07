-- Sección "Administrativo": Recordatorios a empleados + Pedidos a proveedores
-- (modelo después de Admin Nudo/etc).

-- Recurrencia del recordatorio
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReminderRecurrence') THEN
    CREATE TYPE "ReminderRecurrence" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Reminder" (
  "id"            TEXT NOT NULL,
  "tenantId"      TEXT NOT NULL,
  "employeeId"    TEXT,
  "employeeName"  TEXT NOT NULL,
  "employeePhone" TEXT NOT NULL,
  "recurrence"    "ReminderRecurrence" NOT NULL,
  "dayOfWeek"     INTEGER,
  "dayOfMonth"    INTEGER,
  "timeOfDay"     TEXT NOT NULL DEFAULT '09:00',
  "message"       TEXT NOT NULL,
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "lastSentAt"    TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Reminder_tenantId_fkey') THEN
    ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Reminder_employeeId_fkey') THEN
    ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "Reminder_tenantId_isActive_idx" ON "Reminder"("tenantId", "isActive");

-- Proveedores
CREATE TABLE IF NOT EXISTS "Supplier" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "phone"     TEXT NOT NULL,
  "email"     TEXT,
  "notes"     TEXT,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Supplier_tenantId_fkey') THEN
    ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "Supplier_tenantId_isActive_idx" ON "Supplier"("tenantId", "isActive");

-- Productos frecuentes
CREATE TABLE IF NOT EXISTS "FrequentProduct" (
  "id"           TEXT NOT NULL,
  "tenantId"     TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "defaultQty"   DECIMAL(10,2) NOT NULL DEFAULT 1,
  "defaultUnit"  TEXT NOT NULL DEFAULT 'kg',
  "dispatchDay"  TEXT,
  "supplierId"   TEXT,
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FrequentProduct_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FrequentProduct_tenantId_fkey') THEN
    ALTER TABLE "FrequentProduct" ADD CONSTRAINT "FrequentProduct_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FrequentProduct_supplierId_fkey') THEN
    ALTER TABLE "FrequentProduct" ADD CONSTRAINT "FrequentProduct_supplierId_fkey"
      FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "FrequentProduct_tenantId_supplierId_idx" ON "FrequentProduct"("tenantId", "supplierId");

-- Purchase orders (historial)
CREATE TABLE IF NOT EXISTS "PurchaseOrder" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseOrder_tenantId_fkey') THEN
    ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "PurchaseOrder_tenantId_createdAt_idx" ON "PurchaseOrder"("tenantId", "createdAt");

CREATE TABLE IF NOT EXISTS "PurchaseOrderItem" (
  "id"           TEXT NOT NULL,
  "orderId"      TEXT NOT NULL,
  "productName"  TEXT NOT NULL,
  "qty"          DECIMAL(10,2) NOT NULL,
  "unit"         TEXT NOT NULL,
  "supplierId"   TEXT,
  "supplierName" TEXT,
  "supplierPhone" TEXT,
  "dispatchDay"  TEXT,
  "notes"        TEXT,
  CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseOrderItem_orderId_fkey') THEN
    ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "PurchaseOrderItem_orderId_idx" ON "PurchaseOrderItem"("orderId");
CREATE INDEX IF NOT EXISTS "PurchaseOrderItem_supplierId_idx" ON "PurchaseOrderItem"("supplierId");

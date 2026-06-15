# 17 — Módulo Contable + Auditoría de Comisiones (diseño)

**Estado:** propuesta de diseño (sin implementar). Acordado con el dueño el
2026-06-15: primero el documento, luego se construye en una sesión dedicada.

**Objetivo del dueño (textual):**

> "Un apartado contable donde se lleve de manera automática los registros del
> negocio: ingresos, comisiones por pagar, pagos y el total, incluso con
> asientos contables para poder enviar a futuro, auditar y verificar que todo
> esté bien."
>
> "En temas de comisiones, detectar errores y duplicaciones de comisiones."

Son dos entregables que comparten datos:
1. **Contabilidad** — estados financieros automáticos + libro de asientos
   (doble partida) exportable y auditable.
2. **Auditoría de comisiones** — detección automática de duplicados y errores.

---

## 1. Qué existe hoy (no se reconstruye)

| Modelo | Rol | Archivo |
|---|---|---|
| `Commission` | Comisión devengada por afiliado/embajador/vendor | `backend/prisma/schema.prisma` |
| `CommissionPayout` | Lote de pago a un afiliado (con comprobante) | idem |
| `CommissionPayoutItem` | Puente Commission↔Payout (1 comisión = 1 payout) | idem |
| `PaymentProfile` | Datos bancarios/Binance del afiliado | idem |
| `CommissionException` | % personalizado por (tenant, recipientCode) | idem |
| `ReferralUse` | Atribución tenant→código (estados SIGNED_UP/ACTIVE/PAYING/CHURNED) | idem |

**Ingresos (revenue):** hoy NO hay un modelo de ingreso. El ingreso del negocio
(lo que paga cada tenant) vive implícito en:
- Webhooks Hotmart (eventos de pago) → `PendingHotmartPayment` / activación.
- `Tenant.planPeriodicity` + precios canónicos de `settings.getLandingPlans()`
  (`BUNDLE_PRICE`), usados por `CommissionRecalcService` para la base de cálculo.

**Protección anti-duplicado actual:**
- UNIQUE `@@unique([referralUseId, recipientCodeId, periodKey])` (2026-06-12).
- Dedup de webhook por `externalTxId` (transacción Hotmart).
- Catch de `P2002` en `reconcileRecurringCommissions`.
- Script de diagnóstico: `backend/scripts/check-commission-duplicates.cjs`.
- (2026-06-15) `reconcileRecurringCommissions` ahora ignora códigos
  `isActive=false` → un código desactivado deja de devengar.

**Conclusión:** falta (a) un modelo de **ingreso** explícito, (b) un libro de
**asientos contables**, y (c) un panel de **auditoría** que corra el chequeo de
duplicados/errores online (hoy solo existe como script manual).

---

## 2. Modelo de datos propuesto

### 2.1 Ingresos — `RevenueEntry`

Registra cada cobro real al negocio (la "venta" de Clubify). Se crea desde el
webhook Hotmart (pago confirmado / renovación) y desde activaciones manuales.

```prisma
model RevenueEntry {
  id            String   @id @default(uuid())
  tenantId      String
  tenant        Tenant   @relation(fields: [tenantId], references: [id])
  source        String   // HOTMART | MANUAL | TRIAL_CONVERSION
  externalTxId  String?  // transacción Hotmart (dedup)
  grossAmount   Decimal  @db.Decimal(12, 2)
  currency      String   @default("USD")
  periodKey     String   // YYYY-MM del devengo
  occurredAt    DateTime
  planPeriodicity String?
  createdAt     DateTime @default(now())

  @@unique([externalTxId])           // dedup duro por transacción
  @@index([tenantId, periodKey])
}
```

> Migración de datos: backfill desde eventos Hotmart históricos +
> `Commission.createdAt`/`periodKey` para reconstruir meses pasados.

### 2.2 Asientos de doble partida — `JournalEntry` + `JournalLine`

Cada hecho económico genera UN asiento balanceado (Σ débitos = Σ créditos).
Esto es lo que permite "auditar y verificar que todo esté bien".

```prisma
model JournalEntry {
  id          String        @id @default(uuid())
  date        DateTime
  memo        String
  sourceType  String        // REVENUE | COMMISSION_ACCRUAL | COMMISSION_PAYOUT | ADJUSTMENT
  sourceId    String?       // id del RevenueEntry / Commission / CommissionPayout
  tenantId    String?       // null = a nivel plataforma
  createdById String?
  createdAt   DateTime      @default(now())
  lines       JournalLine[]

  @@index([sourceType, sourceId])
  @@index([date])
}

model JournalLine {
  id        String       @id @default(uuid())
  entryId   String
  entry     JournalEntry @relation(fields: [entryId], references: [id], onDelete: Cascade)
  account   String       // código de cuenta (ver plan de cuentas)
  debit     Decimal      @db.Decimal(12, 2) @default(0)
  credit    Decimal      @db.Decimal(12, 2) @default(0)

  @@index([account])
  @@index([entryId])
}
```

**Invariante:** por cada `JournalEntry`, `Σ debit == Σ credit`. Se valida en el
service antes de persistir (transacción) y hay un test de "trial balance" que
suma todo y verifica que cuadre en 0.

### 2.3 Plan de cuentas (mínimo)

| Código | Cuenta | Naturaleza |
|---|---|---|
| `1000` | Caja / Banco | Activo |
| `1100` | Hotmart por liquidar (cuentas por cobrar) | Activo |
| `2000` | Comisiones por pagar | Pasivo |
| `4000` | Ingresos por suscripciones | Ingreso |
| `5000` | Gasto de comisiones | Gasto |

### 2.4 Asientos canónicos (cómo se generan automáticamente)

**a) Ingreso confirmado** (RevenueEntry creado):
```
Dr 1100 Hotmart por liquidar   100.00
   Cr 4000 Ingresos suscripción       100.00
```

**b) Devengo de comisión** (Commission creada, status PENDING/APPROVED):
```
Dr 5000 Gasto de comisiones      20.00
   Cr 2000 Comisiones por pagar         20.00
```

**c) Pago de comisión** (CommissionPayout PAID):
```
Dr 2000 Comisiones por pagar     20.00
   Cr 1000 Caja / Banco                 20.00
```

**d) Anulación de comisión** (Commission → REJECTED, ej. borrado por error —
ver doc de borrado-con-anulación 2026-06-15): asiento reverso de (b):
```
Dr 2000 Comisiones por pagar     20.00
   Cr 5000 Gasto de comisiones          20.00
```

Con esto, "comisiones por pagar" = saldo de la cuenta `2000`, "pagos" = débitos
a `2000`, "ingresos" = créditos a `4000`, y "el total" = balance de comprobación.

---

## 3. Auditoría de comisiones (errores + duplicados)

**Ya existe (no rehacer):** `/admin/commissions/audit` →
`GET /admin/commissions/audit/duplicates` detecta duplicados (mismo
referralUseId+recipientCodeId+mes) y permite `mark-rejected` en lote. Esto
cubre el chequeo #1. Falta **agregar los chequeos #2–#6** sobre el mismo panel
(endpoint `GET /admin/accounting/commission-audit` o ampliar el existente):

**Chequeos:**
1. **Duplicados** — mismo `(referralUseId, recipientCodeId, periodKey)` con
   `COUNT(*) > 1` (incluye legacy con `recipientCodeId` null derivando del use).
2. **Huérfanas** — Commission con `recipientCodeId` apuntando a un código
   inexistente o `ReferralUse` sin tenant.
3. **Monto fuera de rango** — `amount` que no cuadra con
   `base × % efectivo` (±1% por redondeo). Detecta % mal aplicado.
4. **Pagadas sin payout** — `status=PAID` sin `CommissionPayoutItem`.
5. **Doble pago** — una Commission enlazada a >1 payout (no debería por UNIQUE,
   pero se verifica).
6. **Descuadre contable** — Commission sin `JournalEntry` de devengo asociado.

Cada hallazgo es accionable desde el panel: anular (REJECTED), fusionar
duplicados, o marcar como revisado.

---

## 4. UI / pantallas (`/superadmin/contabilidad` o `/admin/contabilidad`)

1. **Resumen** — KPIs del período: Ingresos, Gasto de comisiones, Comisiones
   por pagar (saldo cuenta 2000), Pagos del mes, Resultado. Selector de mes.
2. **Balance de comprobación** — saldos por cuenta + verificación Σ=0.
3. **Libro de asientos** — tabla filtrable (fecha, tipo, tenant) + detalle de
   líneas; export CSV/Excel para el contador.
4. **Auditoría de comisiones** — los 6 chequeos de §3 con acciones.
5. **Exportar** — paquete contable del período (asientos + balance) en CSV.

---

## 5. Plan de implementación por fases

| Fase | Alcance | Riesgo |
|---|---|---|
| **F1** | `RevenueEntry` + backfill histórico. Endpoint resumen ingresos. | Bajo |
| **F2** | `JournalEntry`/`JournalLine` + service de asientos + hooks en los 4 eventos (ingreso, devengo, pago, anulación). Backfill de asientos. | Medio |
| **F3** | Vista `/contabilidad`: resumen + balance + libro + export. | Bajo |
| **F4** | Auditoría online de comisiones (6 chequeos + acciones). | Medio |
| **F5** | Cierre mensual: snapshot inmutable del balance + bloqueo de edición de meses cerrados. | Medio |

**Migraciones:** F1 y F2 agregan tablas nuevas (no destructivo). Aplicar con el
patrón de scripts idempotentes existente (`apply-pending-migration.cjs` +
`railway run --service Postgres-Nq8w`). Asientos se generan en transacción con
el evento de origen para garantizar consistencia.

**Principio:** el módulo es **derivado** — los asientos se construyen a partir de
los eventos del sistema (Hotmart, Commission, Payout), nunca se editan a mano
salvo `ADJUSTMENT` explícito con autor y motivo (queda en `AuditLog`).

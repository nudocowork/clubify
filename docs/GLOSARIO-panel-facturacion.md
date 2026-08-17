# Glosario — Panel de facturación del Dashboard (`/admin`)

La mayoría de los bugs de este panel eran de **definición**, no de aritmética.
Este glosario fija los términos para que no vuelvan. Código:
`backend/src/admin-reports/admin-reports.service.ts` (`dashboardMetricsV2`,
`billedCompanies`, `resolveDateRange`) + `frontend/.../PremiumDashboard.tsx`.

## Términos

- **COBRADO** — Caja **real** del rango: negocios/grupos cuyo **último cobro
  aprobado** (`Tenant.lastChargeAt` / `BusinessGroup.lastChargeAt`) cae dentro
  del rango. Es el número grande del banner. **Nunca** incluye estimaciones.

- **PROYECTADO / ESTIMADO** — Negocios `ACTIVE` **sin** `lastChargeAt`. Su fecha
  de cobro se *estima* (`currentPeriodEnd − meses del ciclo`, o `createdAt`) y su
  monto es el **precio de lista** del plan, no lo que realmente pagaron. Se
  muestra **aparte** del Cobrado (banner en ámbar, badge "Estimado" en el modal).
  Un cobro real que setee `lastChargeAt` lo convierte en Cobrado.

- **COBRO** — Un evento de pago aprobado. ⚠️ **No existe una tabla de pagos**: el
  sistema solo guarda el **último** cobro por negocio (`lastChargeAt`, un único
  timestamp). Por eso las **renovaciones no se acumulan** en el panel — un negocio
  trimestral que pagó en mayo y agosto aparece **una sola vez** (el cobro de
  agosto). El historial de cobros por mes solo existe, parcialmente, en la tabla
  de **comisiones** (`businessDate`), y solo para negocios con afiliado.

- **UNIDAD** — Una fila del facturado = **un negocio individual** o **un grupo
  empresarial**. El modal las lista todas.

- **NEGOCIO** — Un `Tenant`. En las tarjetas por periodicidad, "N negocios" =
  cantidad de negocios con su **último cobro en el rango** (no renovaciones
  previas del mismo negocio).

- **GRUPO** (empresarial) — Un `BusinessGroup` (varias sedes, ej. "Grupo
  Mistika"). Se factura y cuenta como **1 unidad** con su propio precio
  (`priceUsd`, ej. 3×$50 = $150). Se cuenta **aparte** de los negocios
  individuales (`groupCount`), porque mezclarlos distorsiona el promedio del
  bucket. Un grupo puede tener cobro real ($150) aunque sus negocios miembros
  figuren sin cobro individual — el cobro vive en el grupo.

- **MRR** (Ingreso recurrente) — Σ de la equivalencia **mensual** (precio ÷ meses
  del ciclo) de todos los ACTIVE. Es **recurrente normalizado a mes**, **no
  caja** del período. La serie histórica se **reconstruye por antigüedad**
  (`createdAt`) y **no descuenta churn pasado** → es una **estimación**, distinta
  de MONTO FACTURADO/COBRADO. No son reconciliables entre sí.

- **RANGO** — `today`, `this-week`, `last-30`, `this-quarter`, `this-year`.
  Todos los límites se anclan a la **medianoche de Bogotá** (`America/Bogota`,
  UTC-5). ⚠️ `this-quarter` = **últimos 3 meses (rolling)**, NO el trimestre
  calendario. `this-year` = desde el 1 de enero.

## Invariantes (deben mantenerse)

1. Suma de los 4 buckets == COBRADO del banner, en los 5 rangos.
2. Suma de filas Cobrado del modal == COBRADO del banner (misma lógica de rango).
3. Monotonía por subconjunto: `today ⊆ this-week ⊆ last-30 ⊆ this-quarter ⊆
   this-year` (test en `backend/test/dashboard-billing-range.test.ts`).
4. "Cobrado" no incluye ningún registro sin fecha de cobro real.
5. Un pago a las 20:00 hora Bogotá cae en su día local correcto (test ídem).

## Pendiente (fuera de este trabajo — requiere aprobación)

- **Bug 2 / Fase 2:** el flujo `trial → cliente` genera la comisión pero **no
  setea `Tenant.lastChargeAt`** → hay cobros reales invisibles para el panel.
- **Fase 3 (backfill histórico):** poblar `lastChargeAt` de esos cobros, con
  **generación de comisiones desactivada** (ya existen y se pagaron) y coordinado
  con los cortes automáticos. Auditoría de duplicados antes/después.
- **Renovaciones:** que no se registren como cobros separados es un bug de
  **facturación**, no de dashboard. Escalado aparte.

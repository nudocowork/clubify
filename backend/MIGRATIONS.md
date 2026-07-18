# 🗄️ Cómo aplicar migraciones a PRODUCCIÓN (Clubify backend)

> **Léelo completo antes de tocar la base de producción.** Aplicar mal una migración
> tumba el backend de **todas las marcas** a la vez (error 500 global). Ya pasó.

Verificado contra los scripts reales del repo el 2026-07-17.

---

## ⚠️ La regla de oro

```
1. MIGRAR la base de producción   ← PRIMERO
2. DEPLOYAR el código             ← DESPUÉS
```

**Nunca al revés.** Si deployas código que espera una columna/tabla que aún no existe
en la base, el backend arranca y **revienta con 500 en todas las queries** (el outage
de `isCampaignHost` fue exactamente esto).

Dos cosas que **NO** hacen el trabajo por ti:
- ❌ El `startCommand` de Railway **NO** corre migraciones al deployar.
- ❌ `prisma migrate deploy` **se cuelga** contra esta base — no lo uses en prod.

Por eso usamos **scripts idempotentes** (`scripts/apply-*-migration.cjs`) corridos con
`railway run`. Así se hace acá.

---

## 🎯 El servicio correcto: `Postgres-Nq8w`

En Railway hay **varios** servicios Postgres. El de producción es **`Postgres-Nq8w`**.

| Servicio | ¿Usar? |
|---|---|
| **`Postgres-Nq8w`** | ✅ **SÍ — es la base de producción** |
| `Postgres` | ❌ NO (viejo/decoy) |
| `Postgres-staging` | ❌ NO (staging) |

Todos los comandos de abajo llevan `--service Postgres-Nq8w`. Ese flag inyecta las
variables de esa base (`DATABASE_PUBLIC_URL`) al script, que por eso se conecta a prod.

---

## 📋 El flujo, paso a paso

### 1. Crear y probar la migración en LOCAL
```bash
cd backend
npx prisma migrate dev --name descripcion_corta
```
Esto genera `prisma/migrations/<timestamp>_descripcion_corta/migration.sql` y la aplica
a tu base local. Pruébala en local hasta que funcione.

### 2. Escribir un script de aplicación idempotente
Crea `scripts/apply-<algo>-migration.cjs`. Copia el patrón de un script existente
(ej. `apply-onboarding-token-migration.cjs`) o usa la plantilla del final de este doc.
**Idempotente = se puede correr varias veces sin romper** (chequea si ya existe antes de aplicar).

### 3. Revisar qué hay pendiente en prod (READ-ONLY, seguro)
```bash
cd backend
railway run --service Postgres-Nq8w node scripts/check-pending-migrations.cjs
```
Este script **no modifica nada**. Te dice si hay migraciones en el código que NO están
en la base (🔴 = drift peligroso, va a causar 500).

### 4. Aplicar la migración a PROD
```bash
railway run --service Postgres-Nq8w node scripts/apply-<algo>-migration.cjs
```
Aplica el DDL + registra la migración en `_prisma_migrations`. Termina con
`✅ ... Ahora sí deployá el backend.`

### 5. Re-verificar
```bash
railway run --service Postgres-Nq8w node scripts/check-pending-migrations.cjs
```
Debe decir: `✅ Sin drift peligroso`.

### 6. RECIÉN AHORA, deployar el backend
```bash
cd backend
railway up
```
Siempre desde `backend/` y con el servicio `backend` linkeado.

---

## 🆘 Emergencia: apareció un 500 global después de un deploy

Casi siempre es una **migración sin aplicar**. Sin entrar en pánico:
```bash
cd backend
railway run --service Postgres-Nq8w node scripts/check-pending-migrations.cjs   # ver el drift
railway run --service Postgres-Nq8w node scripts/apply-<lo-que-falte>.cjs        # aplicarla
```
Los scripts son idempotentes, así que correrlos de más es seguro.

---

## 🧩 Plantilla de script de aplicación (idempotente)

```js
// scripts/apply-<algo>-migration.cjs
// Aplica <NOMBRE_MIGRACION> a prod (idempotente). Correr ANTES de deployar el backend.
// Usage: railway run --service Postgres-Nq8w node scripts/apply-<algo>-migration.cjs
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error('No DATABASE_URL'); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const name = '<timestamp>_<descripcion>';   // = nombre de la carpeta en prisma/migrations/

  // 1. ¿Ya existe? (chequea una tabla/columna que crea la migración) → idempotencia
  const already = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_name='MiTabla' AND column_name='miColumna' LIMIT 1`,
  );
  if (already.length) {
    console.log('• Ya aplicada — salto el DDL.');
  } else {
    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'prisma', 'migrations', name, 'migration.sql'), 'utf8',
    );
    const statements = sql
      .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
      .split(';').map((s) => s.trim()).filter(Boolean);
    for (const st of statements) await prisma.$executeRawUnsafe(st);
    console.log(`✅ DDL aplicado (${statements.length} sentencias).`);
  }

  // 2. Registrar en _prisma_migrations para que Prisma la considere aplicada
  const exists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 LIMIT 1`, name,
  );
  if (!exists.length) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
       VALUES ($1, $2, $3, now(), now(), 1)`,
      crypto.randomUUID(), 'manual-apply', name,
    );
    console.log('✅ Registrada en _prisma_migrations.');
  } else {
    console.log('• Ya estaba registrada.');
  }
  await prisma.$disconnect();
  console.log('\nListo. Ahora sí deployá el backend.');
})().catch((e) => { console.error(e); process.exit(1); });
```

---

## ✅ Checklist rápido antes de cada deploy de backend

- [ ] ¿Mi cambio toca la base (nueva columna/tabla/enum)? Si NO → salta a `railway up`.
- [ ] Migración probada en local (`prisma migrate dev`).
- [ ] Script `apply-*.cjs` idempotente escrito.
- [ ] `check-pending-migrations.cjs` corrido en prod → visto el drift.
- [ ] `apply-*.cjs` corrido en prod → aplicado + registrado.
- [ ] `check-pending-migrations.cjs` de nuevo → `✅ Sin drift peligroso`.
- [ ] **Recién ahora:** `railway up` desde `backend/`.

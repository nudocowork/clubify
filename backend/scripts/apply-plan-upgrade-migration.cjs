/**
 * Migración ADITIVA: tabla `PlanUpgrade` (upgrade a plan ANUAL).
 *
 * Crea UNA tabla nueva. No toca ninguna existente, no borra nada y no escribe
 * datos: los negocios que ya están no se enteran.
 *
 * IDEMPOTENTE: todo va con `IF NOT EXISTS`. Correrlo dos veces no cambia nada
 * (la segunda pasada solo imprime el estado). Si la tabla ya se creó con la
 * primera versión del script, esta pasada solo AÑADE las columnas y los dos
 * índices de la segunda tanda (guardián del cobro viejo, barrido por pasarela,
 * anulación y el único de `gatewayTxId`).
 *
 * ⚠️ EL ÍNDICE QUE PRISMA NO SABE ESCRIBIR
 * ----------------------------------------
 * `PlanUpgrade_tenant_vivo_uq` es un ÚNICO **PARCIAL**:
 *
 *     UNIQUE ("tenantId") WHERE estado IN ('PENDIENTE','COMPLETADO')
 *
 * Es lo que impide que un negocio tenga dos upgrades vivos a la vez, incluso si
 * dos peticiones entran en el mismo milisegundo. Prisma no puede expresarlo en
 * el schema, así que vive SOLO aquí — y un `prisma db push` lo borraría en
 * silencio, que es exactamente por lo que en este repo no se corre nunca contra
 * producción.
 *
 * Consecuencia buscada: un negocio tiene UN upgrade COMPLETADO como mucho. Si
 * alguna vez hay que rehacerlo (por ejemplo porque se bajó a mensual y vuelve a
 * subir), primero hay que dejar el anterior en 'CANCELADO'. El servicio ya lo
 * dice con ese mensaje en vez de dejar salir el error de Postgres.
 *
 * CÓMO SE EJECUTA (lectura/escritura sobre producción — NO lo corre el agente):
 *
 *     cd backend
 *     railway run --service Postgres-Nq8w node scripts/apply-plan-upgrade-migration.cjs
 *
 * Se puede correr ANTES de desplegar el backend: la tabla vacía no molesta a la
 * versión vieja. Después del despliegue no hace falta nada más.
 */
const { PrismaClient } = require('@prisma/client');

(async () => {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error('ERROR: no hay DATABASE_PUBLIC_URL ni DATABASE_URL en el entorno');
    process.exit(1);
  }
  console.log('Conectando a:', url.replace(/:\/\/[^@]+@/, '://***:***@'));
  const p = new PrismaClient({ datasources: { db: { url } } });

  console.log('Creando tabla "PlanUpgrade"…');
  await p.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "PlanUpgrade" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "whiteLabelId" TEXT,
    "operationRef" TEXT NOT NULL,
    "periodicidadOrigen" TEXT NOT NULL,
    "periodicidadDestino" TEXT NOT NULL DEFAULT 'ANUAL',
    "planIdOrigen" TEXT,
    "planNombreOrigen" TEXT,
    "planIdDestino" TEXT,
    "planNombreDestino" TEXT,
    "standardPriceUsd" DECIMAL(10,2) NOT NULL,
    "paidAmountUsd" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "metodo" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "nextRenewalAt" TIMESTAMP(3) NOT NULL,
    "manualPaymentId" TEXT,
    "gatewayTxId" TEXT,
    "incomeRecordId" TEXT,
    "commissionId" TEXT,
    "commissionAmount" DECIMAL(10,2),
    "comisionesCreadas" INTEGER NOT NULL DEFAULT 0,
    "comisionOmitidaMotivo" TEXT,
    "actorId" TEXT,
    "notas" TEXT,
    "motivoDeFallo" TEXT,
    "cancelacionEstado" TEXT NOT NULL DEFAULT 'NO_APLICA',
    "cancelacionRef" TEXT,
    "cancelacionAt" TIMESTAMP(3),
    "cancelacionActorId" TEXT,
    "cancelacionMotivo" TEXT,
    "cancelacionAlertaAt" TIMESTAMP(3),
    "precioPactadoAnterior" DECIMAL(10,2),
    "cobroViejoDetectadoAt" TIMESTAMP(3),
    "cobroViejoUltimoAt" TIMESTAMP(3),
    "cobroViejoVeces" INTEGER NOT NULL DEFAULT 0,
    "cobroViejoPeriodEnd" TIMESTAMP(3),
    "cobroViejoComisiones" TEXT,
    "barridoAt" TIMESTAMP(3),
    "barridoNota" TEXT,
    "anuladoAt" TIMESTAMP(3),
    "anuladoActorId" TEXT,
    "anuladoMotivo" TEXT,
    "estadoAlAnular" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlanUpgrade_pkey" PRIMARY KEY ("id")
  );`);

  // Por si la tabla ya existía de una pasada anterior a la que le faltara
  // alguna columna: aditivo y sin efecto si ya están.
  const columnasTardias = [
    ['comisionOmitidaMotivo', 'TEXT'],
    ['cancelacionMotivo', 'TEXT'],
    ['cancelacionAlertaAt', 'TIMESTAMP(3)'],
    ['planIdDestino', 'TEXT'],
    ['planNombreDestino', 'TEXT'],
    // ── Segunda tanda (auditoría del upgrade) ──
    // El precio pactado que el upgrade retira del negocio.
    ['precioPactadoAnterior', 'DECIMAL(10,2)'],
    // Guardián del cobro viejo: qué se restauró, cuántas veces y qué comisión
    // nueva hay que mirar a mano.
    ['cobroViejoDetectadoAt', 'TIMESTAMP(3)'],
    ['cobroViejoUltimoAt', 'TIMESTAMP(3)'],
    ['cobroViejoVeces', 'INTEGER NOT NULL DEFAULT 0'],
    ['cobroViejoPeriodEnd', 'TIMESTAMP(3)'],
    ['cobroViejoComisiones', 'TEXT'],
    // Barrido del cobro por pasarela.
    ['barridoAt', 'TIMESTAMP(3)'],
    ['barridoNota', 'TEXT'],
    // Anulación administrativa.
    ['anuladoAt', 'TIMESTAMP(3)'],
    ['anuladoActorId', 'TEXT'],
    ['anuladoMotivo', 'TEXT'],
    ['estadoAlAnular', 'TEXT'],
  ];
  for (const [col, tipo] of columnasTardias) {
    await p.$executeRawUnsafe(
      `ALTER TABLE "PlanUpgrade" ADD COLUMN IF NOT EXISTS "${col}" ${tipo};`,
    );
  }

  console.log('Creando índices…');
  await p.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "PlanUpgrade_operationRef_key" ON "PlanUpgrade"("operationRef");`,
  );
  await p.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "PlanUpgrade_tenantId_createdAt_idx" ON "PlanUpgrade"("tenantId", "createdAt");`,
  );
  await p.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "PlanUpgrade_whiteLabelId_createdAt_idx" ON "PlanUpgrade"("whiteLabelId", "createdAt");`,
  );
  await p.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "PlanUpgrade_estado_cancelacionEstado_idx" ON "PlanUpgrade"("estado", "cancelacionEstado");`,
  );
  // El barrido del cobro por pasarela busca por (estado, metodo).
  await p.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "PlanUpgrade_estado_metodo_idx" ON "PlanUpgrade"("estado", "metodo");`,
  );
  // ÚNICO sobre la transacción de la pasarela: el barrido completa el acta
  // escribiendo aquí la transacción del aviso, así que un aviso reenviado —o
  // dos actas mirando el mismo cobro— chocan contra este índice en vez de
  // aplicar el upgrade dos veces. En Postgres los NULL son distintos entre sí,
  // así que los upgrades MANUALES (sin transacción) no se estorban.
  await p.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "PlanUpgrade_gatewayTxId_key" ON "PlanUpgrade"("gatewayTxId");`,
  );

  console.log('Creando el ÚNICO PARCIAL (un solo upgrade vivo por negocio)…');
  await p.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "PlanUpgrade_tenant_vivo_uq"
       ON "PlanUpgrade"("tenantId")
       WHERE "estado" IN ('PENDIENTE','COMPLETADO');`,
  );

  // SIN clave foránea a "Tenant", igual que `ManualPayment`: el acta de un
  // upgrade es histórico contable y tiene que sobrevivir al borrado del
  // negocio. El aislamiento por marca no depende de la FK — lo da el
  // middleware de Prisma con solo existir la columna `tenantId`.
  //
  // `updatedAt` en Prisma lo escribe el cliente; el DEFAULT de arriba cubre los
  // INSERT hechos por SQL crudo (scripts, arreglos a mano).

  // Comprobación: que la tabla y, sobre todo, el índice parcial existan.
  const columnas = await p.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'PlanUpgrade' ORDER BY ordinal_position`,
  );
  const indices = await p.$queryRawUnsafe(
    `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'PlanUpgrade' ORDER BY indexname`,
  );
  console.log(`\nColumnas (${columnas.length}):`, columnas.map((c) => c.column_name).join(', '));
  console.log('\nÍndices:');
  for (const i of indices) console.log(`  ${i.indexname}\n    ${i.indexdef}`);
  const parcial = indices.find((i) => i.indexname === 'PlanUpgrade_tenant_vivo_uq');
  console.log(
    parcial && /WHERE/i.test(parcial.indexdef)
      ? '\n✅ El único PARCIAL está puesto: no puede haber dos upgrades vivos por negocio.'
      : '\n❌ FALTA el único parcial — revisar antes de usar el endpoint.',
  );
  const txUnico = indices.find((i) => i.indexname === 'PlanUpgrade_gatewayTxId_key');
  console.log(
    txUnico
      ? '✅ El único de `gatewayTxId` está puesto: un aviso repetido de la pasarela no puede completar dos upgrades.'
      : '❌ FALTA el único de `gatewayTxId` — el barrido por pasarela podría aplicar el mismo cobro dos veces.',
  );

  await p.$disconnect();
  console.log('\nListo.');
})().catch(async (e) => {
  console.error('FALLÓ:', e.message);
  process.exit(1);
});

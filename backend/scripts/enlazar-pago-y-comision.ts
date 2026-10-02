/**
 * Corre contra una base real los DOS caminos del panel, con las clases REALES
 * (no una copia de su lógica):
 *
 *   --asignar <pendingId> <tenantId>   = «Pagos sin activar» → Asignar
 *                                        (enlaza el pago, el ingreso y la comisión)
 *   --comision <tenantId>              = «Generar comisión ahora»
 *
 * Sin --aplicar solo dice qué haría (no escribe).
 *
 *   railway run --service Postgres-Nq8w npx ts-node --transpile-only scripts/enlazar-pago-y-comision.ts --comision <tenantId> --aplicar
 */
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../src/audit/audit.service';
import { SettingsService } from '../src/settings/settings.service';
import { CommissionRecalcService } from '../src/referrals/commission-recalc.service';
import { CommissionExceptionsService } from '../src/admin/commission-exceptions.service';
import { ReferralsService } from '../src/referrals/referrals.service';
import { IncomeRecordService } from '../src/finance/income-record.service';
import { PendingAssignmentService } from '../src/billing/pending-assignment.service';

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes('--aplicar');
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('No DATABASE_URL');
  const prisma = new PrismaClient({
    datasources: { db: { url } },
    // Desde fuera de Railway cada consulta va por el proxy público: los 5 s por
    // defecto de una transacción no alcanzan y se deshace entera.
    transactionOptions: { timeout: 60000, maxWait: 20000 },
  });
  if (!aplicar) await prisma.$executeRawUnsafe('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');

  const p = prisma as never;
  const audit = new AuditService(p);
  const settings = new SettingsService(p);
  const recalc = new CommissionRecalcService(p, audit, settings);
  const exceptions = new CommissionExceptionsService(p, recalc, settings);
  const referrals = new ReferralsService(p, {} as never, {} as never, exceptions, recalc, audit);
  const income = new IncomeRecordService(p);
  const asignacion = new PendingAssignmentService(p, audit, income, referrals);

  if (args[0] === '--asignar') {
    const [, pendingId, tenantId] = args;
    if (!aplicar) {
      console.log('SIMULACIÓN:', JSON.stringify(await asignacion.preview('HOTMART', pendingId, tenantId), null, 1));
    } else {
      console.log('ASIGNADO:', JSON.stringify(await asignacion.assign({ gateway: 'HOTMART', pendingId, tenantId, actorId: null }), null, 1));
    }
  } else if (args[0] === '--comision') {
    const tenantId = args[1];
    if (!aplicar) {
      console.log('SIMULACIÓN: no se escribe. Pasa --aplicar para generar la comisión.');
    } else {
      const r = await referrals.backfillCommissionForCurrentAssignment(tenantId, false);
      console.log('RESULTADO:', JSON.stringify({ creadas: r.creadas, motivo: r.motivo, ultimas: r.commissions.slice(0, 3) }, null, 1));
    }
  }
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

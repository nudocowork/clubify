import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EMAIL_TEMPLATES } from './brand-email-templates';

/**
 * Una plantilla de correo que nadie dispara es peor que no tenerla: el panel la
 * muestra, la marca la edita, la enciende… y no sale nunca.
 *
 * Pasó de verdad. Al reconciliar ramas se perdieron los disparadores de "pago
 * confirmado", "panel listo" y "cuenta reactivada" — los tres correos más
 * frecuentes del ciclo — y nada lo detectó: el catálogo estaba completo y los
 * otros tests pasaban. Este test mira los CALL SITES, no el catálogo.
 */

const SRC = join(__dirname, '..');

function archivosTs(dir: string, acc: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      if (nombre !== 'node_modules') archivosTs(ruta, acc);
    } else if (nombre.endsWith('.ts') && !nombre.endsWith('.spec.ts')) {
      acc.push(ruta);
    }
  }
  return acc;
}

/** Todo el código del backend menos el catálogo, que solo los define. */
const codigo = archivosTs(SRC)
  .filter((f) => !f.endsWith('brand-email-templates.ts'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

describe('cada correo del catálogo tiene quien lo dispare', () => {
  it('ninguna plantilla queda huérfana', () => {
    const huerfanas = EMAIL_TEMPLATES.map((t) => t.id).filter(
      (id) => !codigo.includes(`'${id}'`),
    );
    expect(
      huerfanas,
      'plantillas que el panel muestra pero nadie envía',
    ).toEqual([]);
  });

  it('los correos del ciclo de cobro se disparan desde billing', () => {
    // Estos son los que le llegan al negocio cuando pasa algo con su plata.
    // Si alguno deja de dispararse desde billing, el cliente se queda sin aviso.
    const desdeBilling = ['billing.service.ts', 'stripe.service.ts', 'hotmart.service.ts']
      .map((f) => readFileSync(join(SRC, 'billing', f), 'utf8'))
      .join('\n');

    const delCiclo = [
      'email_payment_confirmed',
      'email_payment_failed',
      'email_account_paused',
      'email_account_reactivated',
      'email_cancellation',
      'email_refunded',
      'email_chargeback',
      'email_payment_reminder_7d',
      'email_payment_reminder_3d',
      'email_payment_reminder_tomorrow',
      'email_payment_due_today',
      'email_payment_overdue',
    ];
    const sinDisparo = delCiclo.filter((id) => !desdeBilling.includes(`'${id}'`));
    expect(sinDisparo, 'correos del ciclo sin disparador en billing').toEqual([]);
  });
});

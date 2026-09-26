import { describe, it, expect, vi } from 'vitest';
import { GrowBusinessService } from './grow-business.service';

/**
 * Un SMS que NO se envía tiene que dejar fila en «Mensajes enviados».
 *
 * EL PORQUÉ (2026-09-26): esa pantalla existe para responder «¿esto salió?».
 * Cuando un mensaje se descarta sin registrarse, la pantalla no dice «no lo
 * sé» — dice que no salió nada, y eso se lee como un diagnóstico. Javier buscó
 * los SMS de un negocio, no los vio, y concluyó que el sistema no los mandaba.
 *
 * De las salidas de `sendSmsWithCreds`, las de los topes ya registraban. Las
 * DOS primeras no: plantilla apagada y número en la lista de no molestar. Son
 * decisiones NUESTRAS, no fallos del proveedor, y son justo las que alguien va
 * a venir a preguntar.
 */

const CREDS = { locationId: 'loc-1', apiKey: 'no-importa', switchNumber: null };

function montar(opciones: { bloqueados?: string[] } = {}) {
  const filas: any[] = [];
  const prisma: any = {
    setting: {
      findUnique: async ({ where }: any) =>
        where.key === 'mensajes.numerosBloqueados' && opciones.bloqueados
          ? { value: JSON.stringify(opciones.bloqueados) }
          : null,
    },
    // `registrarEnvio` deduce la marca del negocio cuando el llamador no la
    // manda. Sin esto lanza, el try/catch se lo traga y NO hay fila — que es
    // exactamente el síntoma que se está probando: el doble mentiría.
    tenant: { findUnique: async () => ({ whiteLabelId: null }) },
    messageLog: { create: vi.fn(async ({ data }: any) => filas.push(data)) },
  };
  const svc = new GrowBusinessService(prisma);
  return { svc, filas, prisma };
}

describe('los cortes que antes desaparecían sin rastro', () => {
  it('PLANTILLA APAGADA: no se envía, pero queda la fila y el motivo', async () => {
    const { svc, filas } = montar();
    const r = await svc.sendSmsWithCreds(CREDS, '+573001112233', '   ', {
      tenantId: 't1',
      templateId: 'payment_reminder_3d',
      feature: 'billing',
    } as any);
    expect(r.ok).toBe(false);
    expect(filas).toHaveLength(1);
    expect(filas[0].channel).toBe('SMS');
    expect(filas[0].status).toBe('failed');
    expect(filas[0].error).toMatch(/plantilla apagada/);
    // Y atada al negocio, que es por donde se va a buscar.
    expect(filas[0].tenantId).toBe('t1');
  });

  it('NO MOLESTAR: idem, y se guarda el texto que se iba a mandar', async () => {
    const { svc, filas } = montar({ bloqueados: ['+57 300 111 2233'] });
    const r = await svc.sendSmsWithCreds(
      CREDS,
      '+573001112233',
      'Hola, en 3 días se renueva tu suscripción.',
      { tenantId: 't1', feature: 'billing' } as any,
    );
    expect(r.ok).toBe(false);
    expect(filas).toHaveLength(1);
    expect(filas[0].error).toMatch(/no molestar/);
    expect(filas[0].preview).toMatch(/se renueva tu suscripción/);
  });

  it('la lista compara los ÚLTIMOS 10 dígitos, no el texto', async () => {
    // El mismo número llega como «+57 300…», «57300…» o «300…» según de dónde
    // venga. Si se comparara literal, bloquear uno no bloquearía a los otros.
    const { svc, filas } = montar({ bloqueados: ['3001112233'] });
    await svc.sendSmsWithCreds(CREDS, '+57 300 111 2233', 'Hola', {
      tenantId: 't1',
    } as any);
    expect(filas).toHaveLength(1);
    expect(filas[0].error).toMatch(/no molestar/);
  });

  it('un número que NO está en la lista sigue su camino', async () => {
    const { svc, filas } = montar({ bloqueados: ['3009999999'] });
    await svc
      .sendSmsWithCreds(CREDS, '+573001112233', 'Hola', { tenantId: 't1' } as any)
      .catch(() => null);
    // No se cortó aquí: si hay fila, no es por «no molestar».
    for (const f of filas) expect(f.error ?? '').not.toMatch(/no molestar/);
  });

  it('LA PRUEBA SABE PONERSE EN ROJO: con el código viejo no había fila', async () => {
    // El código de antes hacía `return` justo después del log, sin registrar.
    const { svc, filas } = montar();
    await svc.sendSmsWithCreds(CREDS, '+573001112233', '', {
      tenantId: 't1',
    } as any);
    expect(filas.length).toBeGreaterThan(0);
  });
});

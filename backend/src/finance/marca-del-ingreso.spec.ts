import { describe, it, expect } from 'vitest';
import { IncomeRecordService } from './income-record.service';

/**
 * A qué marca se le apunta un ingreso.
 *
 * EL FALLO (2026-09-11, Jhon): «se realizaron varios pagos hoy y no se veían
 * en Pagos procesados». Los cinco cobros estaban en la base, pero con
 * `whiteLabelId` en null. El dashboard de cobros filtra por marca, así que la
 * tarjeta marcaba **$0 con $668 ya cobrados**.
 *
 * El origen era un `select` del negocio que no pedía `whiteLabelId`: llegaba
 * `undefined` y el `?? null` lo guardaba como «sin marca». Un ingreso con
 * negocio conocido SIEMPRE puede resolver su marca, así que ya no depende de
 * que el llamador se acuerde.
 */
function servicio(opts: {
  marcaDelNegocio?: string | null;
  negocioExiste?: boolean;
}) {
  let guardado: any = null;
  // Se cuentan por separado: desde 2026-09-12 el servicio también consulta el
  // negocio para resolver el PLAN del ingreso, y ese viaje no dice nada sobre
  // si la marca se resolvió sola o vino del llamador.
  let consultasDeMarca = 0;
  const prisma: any = {
    incomeRecord: {
      findUnique: async () => null,
      create: async ({ data }: any) => {
        guardado = data;
        return data;
      },
    },
    setting: { findUnique: async () => null },
    tenant: {
      findUnique: async ({ select }: any) => {
        if (select?.whiteLabelId) consultasDeMarca += 1;
        if (opts.negocioExiste === false) return null;
        return select?.planId
          ? { planId: 'plan-1' }
          : { whiteLabelId: opts.marcaDelNegocio ?? null };
      },
    },
  };
  return {
    srv: new IncomeRecordService(prisma),
    verGuardado: () => guardado,
    verConsultasDeMarca: () => consultasDeMarca,
  };
}

const COBRO = {
  gateway: 'HOTMART' as const,
  externalTxId: 'HP123',
  grossUsd: 150,
  saleDate: new Date('2026-09-11T14:05:00Z'),
  brandName: 'Revent',
};

describe('marca de un ingreso', () => {
  it('si el llamador la manda, esa es', async () => {
    const c = servicio({ marcaDelNegocio: 'wl-otra' });
    await c.srv.record({ ...COBRO, tenantId: 't1', whiteLabelId: 'wl-sellea' });
    expect(c.verGuardado().whiteLabelId).toBe('wl-sellea');
    // Y no se pregunta por la marca del negocio: la del llamador manda.
    expect(c.verConsultasDeMarca()).toBe(0);
  });

  it('si NO la manda, sale del negocio — el caso de los $668 invisibles', async () => {
    const c = servicio({ marcaDelNegocio: 'wl-clubify' });
    await c.srv.record({ ...COBRO, tenantId: 't1' });
    expect(c.verGuardado().whiteLabelId).toBe('wl-clubify');
  });

  it('un `undefined` del select tampoco se guarda como «sin marca»', async () => {
    // Exactamente lo que pasaba: `(tenant as {…}).whiteLabelId ?? null` sobre
    // un objeto que no traía el campo.
    const c = servicio({ marcaDelNegocio: 'wl-clubify' });
    await c.srv.record({ ...COBRO, tenantId: 't1', whiteLabelId: undefined });
    expect(c.verGuardado().whiteLabelId).toBe('wl-clubify');
  });

  it('sin negocio se queda sin marca, que es lo correcto', async () => {
    // Los packs de créditos no crean negocio: ahí null es la respuesta buena,
    // no un fallo que haya que tapar.
    const c = servicio({});
    await c.srv.record({ ...COBRO, tenantId: null });
    expect(c.verGuardado().whiteLabelId).toBeNull();
    expect(c.verConsultasDeMarca()).toBe(0);
  });

  it('un negocio que ya no está no impide registrar el ingreso', async () => {
    const c = servicio({ negocioExiste: false });
    await c.srv.record({ ...COBRO, tenantId: 't-borrado' });
    expect(c.verGuardado()).not.toBeNull();
    expect(c.verGuardado().whiteLabelId).toBeNull();
    expect(c.verGuardado().grossUsd).toBe(150);
  });

  it('un negocio sin marca asignada tampoco inventa una', async () => {
    // Nunca caer a Clubify por defecto: es la fuga de marca de siempre.
    const c = servicio({ marcaDelNegocio: null });
    await c.srv.record({ ...COBRO, tenantId: 't1' });
    expect(c.verGuardado().whiteLabelId).toBeNull();
  });
});

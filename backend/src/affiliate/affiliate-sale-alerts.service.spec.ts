import { describe, it, expect } from 'vitest';
import { AffiliateSaleAlertsService } from './affiliate-sale-alerts.service';

/**
 * Avisos de venta y renovación a afiliados (15-09-2026).
 *
 * Tres fallos a la vez: en una venta repartida el SMS del influencer se lo
 * llevaba el dueño del enlace, un teléfono mal escrito quedaba como «enviado»,
 * y quien lleva la campaña no se enteraba de nada.
 */

type Codigo = {
  id: string;
  ownerName: string;
  ownerWhatsapp: string;
  role: string;
};
const codigo = (
  id: string,
  ownerName: string,
  ownerWhatsapp: string,
  role: string,
): Codigo => ({ id, ownerName, ownerWhatsapp, role });

const CLUBIFY = 'wl-clubify';
const OTRA_MARCA = 'wl-otra';

const JUAN = codigo('juan', 'Juan Camilo', '+573001110001', 'VENDOR');
const NICO = codigo('nico', 'Nicolas Quintero', '+573001110002', 'INFLUENCER');
// Once dígitos y sin prefijo: un 9 de más, como el número que tenía guardado.
const NICO_MAL = codigo('nico', 'Nicolas Quintero', '30011100029', 'INFLUENCER');
const COPIA = { name: 'Javier', phone: '+573001110003', whiteLabelId: CLUBIFY };

let reloj = Date.parse('2026-09-15T13:00:00Z');
function comision(o: {
  id: string;
  uso: string;
  periodo: string;
  para: Codigo;
  enlace: Codigo;
  negocio?: string;
  monto?: number;
  marca?: string | null;
}) {
  reloj += 1000;
  return {
    id: o.id,
    referralUseId: o.uso,
    periodKey: o.periodo,
    amount: o.monto ?? 15,
    currency: 'USD',
    createdAt: new Date(reloj),
    recipientCode: o.para,
    referralUse: {
      referralCode: o.enlace,
      tenant: {
        name: o.negocio ?? 'Urban Café',
        brandName: null,
        whiteLabelId: o.marca === undefined ? CLUBIFY : o.marca,
      },
    },
  };
}

function montar(
  nuevas: any[],
  opts: { historicas?: any[]; avisadas?: string[]; copias?: unknown } = {},
) {
  const filas = new Map<string, any>();
  for (const id of opts.avisadas ?? []) filas.set(id, { commissionId: id });
  const todas = [...(opts.historicas ?? []), ...nuevas];
  const sms: Array<{ telefono: string; texto: string }> = [];
  const ajustes: Record<string, string> = {
    'afiliados.avisoVentas.desde': '2026-01-01T00:00:00.000Z',
  };
  if (opts.copias !== undefined) {
    ajustes['afiliados.avisoVentas.copias'] = JSON.stringify(opts.copias);
  }
  const prisma = {
    setting: {
      findUnique: async ({ where }: any) =>
        ajustes[where.key] ? { value: ajustes[where.key] } : null,
      upsert: async () => ({}),
    },
    commission: {
      findMany: async ({ where }: any) =>
        where.id?.in
          ? nuevas.filter((c) => where.id.in.includes(c.id))
          : nuevas.filter((c) => !where.amount || Number(c.amount) > where.amount.gt),
      count: async ({ where }: any) => {
        const periodo = where.OR?.[1]?.periodKey?.not;
        return todas.filter(
          (x) =>
            x.referralUseId === where.referralUseId &&
            x.createdAt < where.createdAt.lt &&
            (!where.OR || x.periodKey == null || x.periodKey !== periodo),
        ).length;
      },
    },
    whiteLabel: { findFirst: async () => ({ id: CLUBIFY }) },
    affiliateSaleAlert: {
      findMany: async ({ where }: any) =>
        [...filas.values()].filter((f) =>
          where.commissionId.in.includes(f.commissionId),
        ),
      create: async ({ data }: any) => {
        if (filas.has(data.commissionId)) {
          throw Object.assign(new Error('duplicada'), { code: 'P2002' });
        }
        filas.set(data.commissionId, { ...data, ok: false });
        return data;
      },
      update: async ({ where, data }: any) => {
        const fila = { ...filas.get(where.commissionId), ...data };
        filas.set(where.commissionId, fila);
        return fila;
      },
    },
  };
  const alerts = {
    sendInternalAlert: async (telefono: string, texto: string) => {
      sms.push({ telefono, texto });
      return { ok: true };
    },
  };
  const svc = new AffiliateSaleAlertsService(prisma as any, alerts as any);
  return { svc, sms, filas };
}

/** La renovación de Urban Café: enlace del vendedor, comisión también para su influencer. */
function renovacionRepartida() {
  const historicas = [
    comision({ id: 'h1', uso: 'u1', periodo: '2026-08', para: JUAN, enlace: JUAN }),
    comision({ id: 'h2', uso: 'u1', periodo: '2026-08', para: NICO, enlace: JUAN }),
  ];
  const nuevas = [
    comision({ id: 'c1', uso: 'u1', periodo: '2026-09', para: JUAN, enlace: JUAN, monto: 7.5 }),
    comision({ id: 'c2', uso: 'u1', periodo: '2026-09', para: NICO, enlace: JUAN }),
  ];
  return { historicas, nuevas };
}

describe('a quién le llega el SMS de una comisión', () => {
  it('en una renovación repartida, cada comisión le llega a su dueño', async () => {
    const { historicas, nuevas } = renovacionRepartida();
    const { svc, sms } = montar(nuevas, { historicas });
    await svc.pasada();
    expect(sms.map((m) => m.telefono)).toEqual(['+573001110001', '+573001110002']);
    expect(sms[0].texto).toContain('renovó su plan con tu enlace');
    expect(sms[1].texto).toContain('con el enlace de Juan Camilo, de tu equipo');
  });

  it('la segunda comisión del primer pago no sale como renovación', async () => {
    const { svc, sms, filas } = montar([
      comision({ id: 'n1', uso: 'u2', periodo: '2026-09', para: JUAN, enlace: JUAN, negocio: 'Laly.com' }),
      comision({ id: 'n2', uso: 'u2', periodo: '2026-09', para: NICO, enlace: JUAN, negocio: 'Laly.com' }),
    ]);
    await svc.pasada();
    expect(filas.get('n1').esRenovacion).toBe(false);
    expect(filas.get('n2').esRenovacion).toBe(false);
    expect(sms[1].texto).toContain('Nueva venta en tu equipo');
  });

  it('un teléfono mal escrito no se da por enviado', async () => {
    const { svc, sms, filas } = montar([
      comision({ id: 'e1', uso: 'u3', periodo: '2026-09', para: NICO_MAL, enlace: NICO_MAL, negocio: 'Essentrix' }),
    ]);
    await svc.pasada();
    expect(sms).toHaveLength(0);
    expect(filas.get('e1')).toMatchObject({ ok: false, phone: '30011100029' });
    expect(filas.get('e1').error).toContain('no es válido');
  });
});

describe('la copia a quien lleva la campaña', () => {
  it('sale una por venta, con cada comisión dentro', async () => {
    const { historicas, nuevas } = renovacionRepartida();
    const { svc, sms } = montar(nuevas, { historicas, copias: [COPIA] });
    await svc.pasada();
    const copias = sms.filter((m) => m.telefono === COPIA.phone);
    expect(copias).toHaveLength(1);
    expect(copias[0].texto).toContain(
      'Renovación: Urban Café renovó su plan con el enlace de Juan Camilo (vendedor)',
    );
    expect(copias[0].texto).toContain('• Comisión de Juan Camilo (vendedor): 7.5 USD');
    expect(copias[0].texto).toContain('• Comisión de Nicolas Quintero (influencer): 15 USD');
  });

  it('dice a quién no le llegó su aviso y por qué', async () => {
    const historicas = [
      comision({ id: 'h3', uso: 'u3', periodo: '2026-08', para: NICO_MAL, enlace: NICO_MAL, negocio: 'Essentrix' }),
    ];
    const { svc, sms } = montar(
      [comision({ id: 'e2', uso: 'u3', periodo: '2026-09', para: NICO_MAL, enlace: NICO_MAL, negocio: 'Essentrix' })],
      { historicas, copias: [COPIA] },
    );
    await svc.pasada();
    expect(sms).toHaveLength(1);
    expect(sms[0].telefono).toBe(COPIA.phone);
    expect(sms[0].texto).toContain('Renovación: Essentrix');
    expect(sms[0].texto).toContain(
      '⚠️ A Nicolas Quintero no le llegó el aviso: su teléfono (30011100029) no es válido.',
    );
  });

  it('solo le llegan las ventas de su marca', async () => {
    const { svc, sms } = montar(
      [comision({ id: 'o1', uso: 'u5', periodo: '2026-09', para: NICO, enlace: NICO, marca: OTRA_MARCA })],
      { copias: [COPIA] },
    );
    await svc.pasada();
    expect(sms.map((m) => m.telefono)).toEqual([NICO.ownerWhatsapp]);
  });

  it('a quien ya recibió su comisión no se le repite como copia', async () => {
    const { svc, sms } = montar(
      [comision({ id: 'd1', uso: 'u6', periodo: '2026-09', para: NICO, enlace: NICO })],
      { copias: [{ name: 'Nico', phone: '3001110002' }] },
    );
    await svc.pasada();
    expect(sms).toHaveLength(1);
  });

  it('un ajuste roto no manda copias ni tumba los avisos', async () => {
    const { svc, sms } = montar(
      [comision({ id: 'r0', uso: 'u7', periodo: '2026-09', para: NICO, enlace: NICO })],
      { copias: 'no es una lista' },
    );
    await svc.pasada();
    expect(sms.map((m) => m.telefono)).toEqual([NICO.ownerWhatsapp]);
  });
});

describe('sin repetir', () => {
  it('lo ya avisado no vuelve a salir', async () => {
    const { svc, sms } = montar(
      [comision({ id: 'r1', uso: 'u4', periodo: '2026-09', para: NICO, enlace: NICO })],
      { avisadas: ['r1'], copias: [COPIA] },
    );
    await svc.pasada();
    expect(sms).toHaveLength(0);
  });

  it('con la pasada llena, la última venta espera entera a la siguiente', async () => {
    const nuevas = Array.from({ length: 48 }, (_, i) =>
      comision({ id: `m${i}`, uso: `mu${i}`, periodo: '2026-09', para: NICO, enlace: NICO }),
    );
    nuevas.push(
      comision({ id: 'z1', uso: 'uz', periodo: '2026-09', para: JUAN, enlace: JUAN }),
      comision({ id: 'z2', uso: 'uz', periodo: '2026-09', para: NICO, enlace: JUAN }),
    );
    const { svc, sms, filas } = montar(nuevas);
    await svc.pasada();
    expect(sms).toHaveLength(48);
    expect(filas.has('z1')).toBe(false);
    expect(filas.has('z2')).toBe(false);
  });
});

describe('lo que no es una venta, y lo que se quedaba fuera (Fable)', () => {
  it('un ajuste negativo por reembolso no se avisa como renovación', async () => {
    const historicas = [
      comision({ id: 'h9', uso: 'u9', periodo: '2026-08', para: NICO, enlace: NICO }),
    ];
    const { svc, sms } = montar(
      [comision({ id: 'aj1', uso: 'u9', periodo: 'adj-1', para: NICO, enlace: NICO, monto: -15 })],
      { historicas, copias: [COPIA] },
    );
    await svc.pasada();
    expect(sms).toHaveLength(0);
  });

  it('con 50 ya avisadas en la ventana, la nueva sale igual', async () => {
    const viejas = Array.from({ length: 50 }, (_, i) =>
      comision({ id: `v${i}`, uso: `vu${i}`, periodo: '2026-09', para: NICO, enlace: NICO }),
    );
    const nueva = comision({ id: 'nueva', uso: 'un', periodo: '2026-09', para: JUAN, enlace: JUAN });
    const { svc, sms } = montar([...viejas, nueva], { avisadas: viejas.map((v) => v.id) });
    await svc.pasada();
    expect(sms.map((m) => m.telefono)).toEqual([JUAN.ownerWhatsapp]);
  });

  it('los negocios viejos de Clubify, sin marca, también tienen copia', async () => {
    const { svc, sms } = montar(
      [comision({ id: 's1', uso: 'us', periodo: '2026-09', para: NICO, enlace: NICO, marca: null })],
      { copias: [COPIA] },
    );
    await svc.pasada();
    expect(sms.map((m) => m.telefono)).toEqual([NICO.ownerWhatsapp, COPIA.phone]);
  });
});

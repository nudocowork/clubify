import { describe, it, expect } from 'vitest';
import {
  datosDelComprador,
  enHorarioDeSilencio,
  mostrarTelefono,
  queRecordatorioToca,
  textoAvisoAlEquipo,
  textoDelRecordatorio,
} from './recordatorio-de-activacion';
import { RecordatorioDeActivacionService } from './recordatorio-de-activacion.service';

/**
 * Recordatorio al comprador que pagó y no creó su cuenta (2026-09-22).
 *
 * EL PROBLEMA: «los clientes no están registrando su cuenta». El primer aviso
 * sí llegaba (Cristian Cardona, 21-sep: SMS y correo `sent` en MessageLog) y
 * al comprador nadie le volvía a escribir; el único recordatorio era un SMS al
 * equipo a la hora. Pedido por Javier: al cliente, SMS a los 30 min, 24 h y
 * 48 h; al equipo de implementación, aviso a los 30 min y a las 24 h con sus
 * datos y el enlace de activación para reenviárselo.
 *
 * Lo que no se puede romper:
 *   · dos vueltas del cron no mandan el mismo recordatorio dos veces;
 *   · un comprador con dos filas (Hotmart: una por transacción) recibe uno;
 *   · a quien ya tiene cuenta no se le escribe «crea tu cuenta»;
 *   · el primer despliegue no le escribe a compradores de hace semanas;
 *   · a quien le devolvieron el dinero no se le recuerda nada;
 *   · si el envío revienta se reintenta; si Grow Business lo rechaza, no.
 */

const H = 3_600_000;
// 15:00 UTC = 10:00 en Colombia: fuera del horario de silencio.
const AHORA = new Date('2026-09-22T15:00:00Z');
const hace = (ms: number) => new Date(AHORA.getTime() - ms);

describe('queRecordatorioToca', () => {
  const fila = (
    edad: number,
    r1: Date | null = null,
    r2: Date | null = null,
    r3: Date | null = null,
  ) => ({
    createdAt: hace(edad),
    buyerReminder1At: r1,
    buyerReminder2At: r2,
    buyerReminder3At: r3,
  });

  it('nada antes de los 30 min', () => {
    expect(queRecordatorioToca(fila(29 * 60_000), AHORA)).toBeNull();
  });

  it('el primero a los 30 min, una sola vez', () => {
    expect(queRecordatorioToca(fila(30 * 60_000), AHORA)).toBe(1);
    expect(queRecordatorioToca(fila(2 * H, hace(H)), AHORA)).toBeNull();
  });

  it('el segundo a las 24 h, una sola vez', () => {
    expect(queRecordatorioToca(fila(24 * H, hace(23 * H)), AHORA)).toBe(2);
    expect(queRecordatorioToca(fila(25 * H, hace(24 * H), hace(H)), AHORA)).toBeNull();
  });

  it('el tercero a las 48 h, una sola vez', () => {
    expect(queRecordatorioToca(fila(48 * H, hace(47 * H), hace(24 * H)), AHORA)).toBe(3);
    expect(
      queRecordatorioToca(fila(50 * H, hace(49 * H), hace(26 * H), hace(2 * H)), AHORA),
    ).toBeNull();
  });

  it('el pasado no se toca: más de 72 h, nada', () => {
    expect(queRecordatorioToca(fila(73 * H), AHORA)).toBeNull();
  });

  it('un primero tardío no deja caer el segundo una hora después', () => {
    // El primero salió a las 23 h (caída larga): el segundo espera 6 h.
    expect(queRecordatorioToca(fila(24 * H, hace(H)), AHORA)).toBeNull();
    expect(queRecordatorioToca(fila(30 * H, hace(7 * H)), AHORA)).toBe(2);
  });
});

describe('horario de silencio (hora de Colombia)', () => {
  it('de 21:00 a 8:00 no se escribe', () => {
    expect(enHorarioDeSilencio(new Date('2026-09-22T02:00:00Z'))).toBe(true); // 21:00
    expect(enHorarioDeSilencio(new Date('2026-09-22T12:59:00Z'))).toBe(true); // 7:59
    expect(enHorarioDeSilencio(new Date('2026-09-22T13:00:00Z'))).toBe(false); // 8:00
    expect(enHorarioDeSilencio(new Date('2026-09-22T01:59:00Z'))).toBe(false); // 20:59
  });
});

describe('texto', () => {
  it('lleva nombre, marca, enlace y el correo del pago', () => {
    const t = textoDelRecordatorio({
      cual: 1,
      nombre: 'Cristian Cardona',
      marca: 'Sellea',
      enlace: 'https://www.selleala.com/activar?email=a%40b.co',
      email: 'a@b.co',
    });
    expect(t).toContain('Hola Cristian 👋');
    expect(t).toContain('en Sellea');
    expect(t).toContain('https://www.selleala.com/activar?email=a%40b.co');
    expect(t).toContain('(a@b.co)');
    expect(t).not.toMatch(/clubify/i);
  });

  it('el segundo no repite el primero', () => {
    const base = { nombre: null, marca: 'Clubify', enlace: 'x', email: 'a@b.co' };
    expect(textoDelRecordatorio({ ...base, cual: 1 })).not.toBe(
      textoDelRecordatorio({ ...base, cual: 2 }),
    );
    expect(textoDelRecordatorio({ ...base, cual: 2 })).toMatch(/^Hola 👋/);
  });
});

describe('datos del comprador según la pasarela', () => {
  it('Hotmart: checkout_phone antes que phone, y sin negocio (no lo pide)', () => {
    expect(
      datosDelComprador('HOTMART', {
        data: { buyer: { name: 'Ana', checkout_phone: '573001112233', phone: '1' } },
      }),
    ).toEqual({ nombre: 'Ana', telefono: '573001112233', negocio: null });
  });
  it('Stripe: customer_details, con el nombre de la empresa si la marca lo pide', () => {
    expect(
      datosDelComprador('STRIPE', {
        data: {
          object: {
            customer_details: { name: 'Leo', phone: '+573001112233', business_name: 'Café Leo' },
          },
        },
      }),
    ).toEqual({ nombre: 'Leo', telefono: '+573001112233', negocio: 'Café Leo' });
  });
  it('Stripe: o de un campo propio del checkout que diga «negocio»', () => {
    expect(
      datosDelComprador('STRIPE', {
        data: {
          object: {
            customer_details: { name: 'Leo' },
            custom_fields: [
              { key: 'nombredelnegocio', label: { custom: 'Nombre del negocio' }, text: { value: 'Pan de Leo' } },
            ],
          },
        },
      }).negocio,
    ).toBe('Pan de Leo');
  });
});

describe('aviso al equipo de implementación', () => {
  const base = {
    marca: 'Clubify',
    nombre: 'Cristian Cardona',
    negocio: null,
    telefono: '573183762851',
    email: 'cfch15@hotmail.com',
    enlace: 'https://soyclubify.com/activar?email=cfch15%40hotmail.com',
    llegoAlCliente: true,
  };
  it('lleva cliente, negocio, teléfono marcable, correo y enlace', () => {
    const t = textoAvisoAlEquipo({ ...base, cual: 1 });
    expect(t).toContain('(30 min desde el pago)');
    expect(t).toContain('Cliente: Cristian Cardona');
    expect(t).toContain('Negocio: aún no lo registra');
    expect(t).toContain('Teléfono: +573183762851');
    expect(t).toContain('Correo: cfch15@hotmail.com');
    expect(t).toContain('https://soyclubify.com/activar?email=cfch15%40hotmail.com');
  });
  it('a las 24 h lo dice, y avisa si nuestro SMS no le llegó', () => {
    const t = textoAvisoAlEquipo({ ...base, cual: 2, llegoAlCliente: false });
    expect(t).toContain('(24 h desde el pago)');
    expect(t).toContain('NO le llegó');
  });
  it('teléfono: se le pone el + si viene sin él', () => {
    expect(mostrarTelefono('573183762851')).toBe('+573183762851');
    expect(mostrarTelefono('+1 555 000 1111')).toBe('+1 555 000 1111');
    expect(mostrarTelefono('')).toBeNull();
  });
});

// ── La PUERTA: el servicio contra una base falsa ─────────────────────────────

type FilaPendiente = {
  id: string;
  email: string;
  whiteLabelId: string | null;
  rawPayload: unknown;
  createdAt: Date;
  consumedAt: Date | null;
  buyerReminder1At: Date | null;
  buyerReminder2At: Date | null;
  buyerReminder3At: Date | null;
};

function montar(opts: {
  hotmart?: FilaPendiente[];
  stripe?: FilaPendiente[];
  usuarios?: string[];
  /** Transacciones de Hotmart con un evento de devolución guardado. */
  devueltas?: string[];
  envio?: () => { ok: boolean; permanente: boolean };
}) {
  const tablas = { hotmart: opts.hotmart ?? [], stripe: opts.stripe ?? [] };
  const enviados: Array<{ phone: string | null; body: string; whiteLabelId: string | null }> = [];
  const alEquipo: Array<{ body: string; tipo: string }> = [];

  const casa = (f: FilaPendiente, where: Record<string, any>) =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'createdAt') return f.createdAt >= v.gte && f.createdAt <= v.lte;
      const actual = (f as any)[k];
      if (v instanceof Date) return actual instanceof Date && actual.getTime() === v.getTime();
      return actual === v;
    });
  const delegado = (filas: FilaPendiente[]) => ({
    findMany: async ({ where }: any) =>
      filas.filter((f) => casa(f, where)).map((f) => ({ ...f })),
    updateMany: async ({ where, data }: any) => {
      const tocadas = filas.filter((f) => casa(f, where));
      for (const f of tocadas) Object.assign(f, data);
      return { count: tocadas.length };
    },
  });

  const prisma = {
    pendingHotmartPayment: delegado(tablas.hotmart),
    pendingStripePayment: delegado(tablas.stripe),
    user: {
      findFirst: async ({ where }: any) => {
        // La consulta real no distingue mayúsculas: la falsa tampoco.
        expect(where.email.mode).toBe('insensitive');
        const buscado = String(where.email.equals).toLowerCase();
        return (opts.usuarios ?? []).some((u) => u.toLowerCase() === buscado)
          ? { id: 'u1' }
          : null;
      },
    },
    hotmartWebhookEvent: {
      findFirst: async ({ where }: any) => {
        expect(where.payload.path).toEqual(['data', 'purchase', 'transaction']);
        return (opts.devueltas ?? []).includes(where.payload.equals) &&
          where.eventType.in.includes('PURCHASE_REFUNDED')
          ? { id: 'ev1' }
          : null;
      },
    },
    whiteLabel: {
      findFirst: async ({ where }: any) =>
        where.slug === 'clubify'
          ? { id: 'wl-clubify', name: 'Clubify', domain: 'soyclubify.com', appDomain: null }
          : { id: where.id, name: 'Sellea', domain: 'www.selleala.com', appDomain: null },
    },
  };
  const alerts = {
    sendBuyerActivationReminder: async (o: any) => {
      enviados.push({ phone: o.phone, body: o.body, whiteLabelId: o.whiteLabelId });
      return opts.envio ? opts.envio() : { ok: true, permanente: false };
    },
    sendTeamAlert: async (body: string, tipo: string) => {
      alEquipo.push({ body, tipo });
      return { ok: true, sent: 1, total: 1 };
    },
  };
  const svc = new RecordatorioDeActivacionService(prisma as any, alerts as any);
  return { svc, enviados, tablas, alEquipo };
}

const pendiente = (p: Partial<FilaPendiente>): FilaPendiente => ({
  id: Math.random().toString(36).slice(2),
  email: 'cfch15@hotmail.com',
  whiteLabelId: null,
  rawPayload: { data: { buyer: { name: 'Cristian Cardona', checkout_phone: '573183762851' } } },
  createdAt: hace(40 * 60_000),
  consumedAt: null,
  buyerReminder1At: null,
  buyerReminder2At: null,
  buyerReminder3At: null,
  ...p,
});

describe('RecordatorioDeActivacionService', () => {
  it('manda el primero y no lo repite en la vuelta siguiente', async () => {
    const { svc, enviados } = montar({ hotmart: [pendiente({})] });
    expect(await svc.recordar(AHORA)).toBe(1);
    expect(await svc.recordar(new Date(AHORA.getTime() + 10 * 60_000))).toBe(0);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].phone).toBe('573183762851');
    expect(enviados[0].body).toContain('https://soyclubify.com/activar?email=cfch15%40hotmail.com');
    expect(enviados[0].whiteLabelId).toBe('wl-clubify');
  });

  it('dos filas del mismo comprador: un solo SMS', async () => {
    const { svc, enviados, tablas } = montar({
      hotmart: [pendiente({}), pendiente({ createdAt: hace(35 * 60_000) })],
    });
    await svc.recordar(AHORA);
    expect(enviados).toHaveLength(1);
    expect(tablas.hotmart.every((f) => f.buyerReminder1At)).toBe(true);
  });

  it('quien ya tiene cuenta no recibe «crea tu cuenta» (sin importar mayúsculas)', async () => {
    const { svc, enviados } = montar({
      hotmart: [pendiente({})],
      usuarios: ['CFCH15@Hotmail.com'],
    });
    await svc.recordar(AHORA);
    expect(enviados).toHaveLength(0);
  });

  it('a quien le devolvieron el dinero no se le dice «seguimos guardando tu pago»', async () => {
    const { svc, enviados } = montar({
      hotmart: [
        pendiente({
          transactionId: 'HP123',
          createdAt: hace(25 * H),
          buyerReminder1At: hace(24 * H),
        } as any),
      ],
      devueltas: ['HP123'],
    });
    await svc.recordar(AHORA);
    expect(enviados).toHaveLength(0);
  });

  it('un pago ya consumido no se recuerda', async () => {
    const { svc, enviados } = montar({ hotmart: [pendiente({ consumedAt: hace(H) })] });
    await svc.recordar(AHORA);
    expect(enviados).toHaveLength(0);
  });

  it('si el envío reventó, se devuelve el candado y la vuelta siguiente reintenta', async () => {
    let intento = 0;
    const { svc, enviados, tablas } = montar({
      hotmart: [pendiente({})],
      envio: () => (++intento === 1 ? { ok: false, permanente: false } : { ok: true, permanente: false }),
    });
    await svc.recordar(AHORA);
    expect(tablas.hotmart[0].buyerReminder1At).toBeNull();
    await svc.recordar(new Date(AHORA.getTime() + 10 * 60_000));
    expect(enviados).toHaveLength(2);
    expect(tablas.hotmart[0].buyerReminder1At).not.toBeNull();
  });

  it('si Grow Business dijo que no, se queda marcado: no se reintenta cada 10 min', async () => {
    const { svc, enviados, tablas } = montar({
      hotmart: [pendiente({})],
      envio: () => ({ ok: false, permanente: true }),
    });
    await svc.recordar(AHORA);
    await svc.recordar(new Date(AHORA.getTime() + 10 * 60_000));
    expect(enviados).toHaveLength(1);
    expect(tablas.hotmart[0].buyerReminder1At).not.toBeNull();
  });

  it('Stripe sale con la marca del pago', async () => {
    const { svc, enviados } = montar({
      stripe: [
        pendiente({
          whiteLabelId: 'wl-sellea',
          createdAt: hace(25 * H),
          buyerReminder1At: hace(24 * H),
          rawPayload: { data: { object: { customer_details: { name: 'Leo', phone: '+573001112233' } } } },
        }),
      ],
    });
    await svc.recordar(AHORA);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].whiteLabelId).toBe('wl-sellea');
    expect(enviados[0].body).toContain('en Sellea');
    expect(enviados[0].body).toContain('https://www.selleala.com/activar');
    expect(enviados[0].body).not.toMatch(/clubify/i);
  });

  it('a los 30 min avisa al equipo de implementación, una vez', async () => {
    const { svc, alEquipo } = montar({ hotmart: [pendiente({})] });
    await svc.recordar(AHORA);
    await svc.recordar(new Date(AHORA.getTime() + 10 * 60_000));
    expect(alEquipo).toHaveLength(1);
    expect(alEquipo[0].tipo).toBe('implementacion');
    expect(alEquipo[0].body).toContain('Cristian Cardona');
    expect(alEquipo[0].body).toContain('+573183762851');
    expect(alEquipo[0].body).toContain('https://soyclubify.com/activar?email=cfch15%40hotmail.com');
  });

  it('a las 48 h le escribe al cliente pero ya no al equipo', async () => {
    const { svc, enviados, alEquipo } = montar({
      hotmart: [
        pendiente({
          createdAt: hace(49 * H),
          buyerReminder1At: hace(48 * H),
          buyerReminder2At: hace(25 * H),
        }),
      ],
    });
    await svc.recordar(AHORA);
    expect(enviados).toHaveLength(1);
    expect(alEquipo).toHaveLength(0);
  });

  it('si nuestro SMS no le llegó, el equipo se entera igual', async () => {
    const { svc, alEquipo } = montar({
      hotmart: [pendiente({})],
      envio: () => ({ ok: false, permanente: true }),
    });
    await svc.recordar(AHORA);
    expect(alEquipo).toHaveLength(1);
    expect(alEquipo[0].body).toContain('NO le llegó');
  });

  it('si el envío revienta, el equipo espera a la vuelta que lo resuelva', async () => {
    let intento = 0;
    const { svc, alEquipo } = montar({
      hotmart: [pendiente({})],
      envio: () => (++intento === 1 ? { ok: false, permanente: false } : { ok: true, permanente: false }),
    });
    await svc.recordar(AHORA);
    expect(alEquipo).toHaveLength(0);
    await svc.recordar(new Date(AHORA.getTime() + 10 * 60_000));
    expect(alEquipo).toHaveLength(1);
  });

  it('de noche no escribe', async () => {
    const { svc, enviados } = montar({ hotmart: [pendiente({ createdAt: new Date('2026-09-22T02:00:00Z') })] });
    // 03:00 UTC = 22:00 en Colombia.
    expect(await svc.recordar(new Date('2026-09-22T03:00:00Z'))).toBe(0);
    expect(enviados).toHaveLength(0);
  });
});

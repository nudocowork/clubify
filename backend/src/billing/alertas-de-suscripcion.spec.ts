import { describe, expect, it } from 'vitest';
import {
  EventoGuardado,
  NegocioParaAlertas,
  alertasNuevas,
  detectarAlertasDeSuscripcion,
  dominioDeEmpresa,
  textoDelResumen,
} from './alertas-de-suscripcion';

const AHORA = new Date('2026-10-16T15:00:00Z');
const PRODUCTO_CLUBIFY = { id: 4_000_001, name: 'Clubify PRO' };
const dia = (n: number) => new Date(AHORA.getTime() - n * 86_400_000);

function evento(o: {
  tipo: string;
  codigo: string;
  correo: string;
  hace: number;
  tenantId?: string | null;
  producto?: { id: number; name: string } | null;
  plan?: string;
  telefono?: string;
}): EventoGuardado {
  return {
    eventType: o.tipo,
    tenantId: o.tenantId ?? null,
    processedAt: dia(o.hace),
    payload: {
      event: o.tipo,
      data: {
        buyer: { email: o.correo, ...(o.telefono ? { checkout_phone: o.telefono } : {}) },
        subscription: {
          subscriber: { code: o.codigo },
          ...(o.plan ? { plan: { name: o.plan } } : {}),
        },
        ...(o.producto === null ? {} : { product: o.producto ?? PRODUCTO_CLUBIFY }),
      },
    },
  };
}

const MACONDO: NegocioParaAlertas = {
  id: 't-macondo',
  brandName: 'Café Macondo',
  email: 'administracion@cafemacondo.cl',
  hotmartSubscriberCode: 'D99G58Q2',
  correosDeDuenos: ['administracion@cafemacondo.cl'],
};

/** Lo que se vio en Hotmart el 2026-10-16: la nueva paga y está vinculada; la
 *  vieja, trimestral, en «Retraso», con un DELAYED al día y sin negocio. */
function eventosDeMacondo(): EventoGuardado[] {
  const nueva = [
    evento({ tipo: 'PURCHASE_APPROVED', codigo: 'D99G58Q2', correo: MACONDO.email!, hace: 20, tenantId: MACONDO.id, plan: 'Plan Mensual 50 USD' }),
  ];
  const vieja = Array.from({ length: 10 }, (_, i) =>
    evento({ tipo: 'PURCHASE_DELAYED', codigo: 'JSLQIK9H', correo: 'sergio.flores@cafemacondo.cl', hace: 10 - i, plan: 'Plan Trimestral 150 USD' }),
  );
  return [...nueva, ...vieja];
}

describe('detectarAlertasDeSuscripcion', () => {
  it('Café Macondo: dos códigos, el viejo huérfano con DELAYED diarios → UNA alerta de doble suscripción', () => {
    const alertas = detectarAlertasDeSuscripcion({
      eventos: eventosDeMacondo(),
      negocios: [MACONDO],
      ahora: AHORA,
    });
    expect(alertas).toHaveLength(1);
    const a = alertas[0];
    expect(a.tipo).toBe('DOBLE_SUSCRIPCION');
    expect(a.gravedad).toBe('alta');
    expect(a.negocio).toMatchObject({ id: 't-macondo', vinculo: 'dominio' });
    expect(a.id).toBe('doble:t-macondo:D99G58Q2+JSLQIK9H');
    const vieja = a.suscripciones.find((s) => s.codigo === 'JSLQIK9H')!;
    expect(vieja).toMatchObject({
      estado: 'en_retraso',
      reintentos: 10,
      vinculada: false,
      correos: ['sergio.flores@cafemacondo.cl'],
      ultimoEvento: 'PURCHASE_DELAYED',
    });
    expect(a.suscripciones.find((s) => s.codigo === 'D99G58Q2')).toMatchObject({
      estado: 'al_dia',
      vinculada: true,
    });
    // La recomendación dice cuál cancelar y cuál es la buena, con sus correos.
    expect(a.recomendacion).toMatch(/^Cancelar en Hotmart la suscripción JSLQIK9H \(sergio\.flores@cafemacondo\.cl/);
    expect(a.recomendacion).toContain('la activa es D99G58Q2 (administracion@cafemacondo.cl');
    // No sale además como huérfana: sería el mismo problema contado dos veces.
    expect(alertas.some((x) => x.tipo === 'SUSCRIPCION_HUERFANA')).toBe(false);
  });

  it('Café Macondo con teléfono: el vínculo se da por dominio y teléfono', () => {
    const eventos = eventosDeMacondo().map((e) => {
      const p = e.payload as any;
      p.data.buyer.checkout_phone = '+56 9 1234 5678';
      return e;
    });
    const [a] = detectarAlertasDeSuscripcion({ eventos, negocios: [MACONDO], ahora: AHORA });
    expect(a.negocio?.vinculo).toBe('dominio_y_telefono');
  });

  it('si el webhook casó la vieja por correo (tenantId en el evento), sigue siendo doble', () => {
    const eventos = eventosDeMacondo().map((e) => ({ ...e, tenantId: MACONDO.id }));
    const alertas = detectarAlertasDeSuscripcion({ eventos, negocios: [MACONDO], ahora: AHORA });
    expect(alertas.map((a) => a.tipo)).toEqual(['DOBLE_SUSCRIPCION']);
  });

  it('negocio sano con una sola suscripción → nada', () => {
    const sano: NegocioParaAlertas = { id: 't1', brandName: 'Sano', email: 'a@sano.com', hotmartSubscriberCode: 'AAA111' };
    const alertas = detectarAlertasDeSuscripcion({
      eventos: [
        evento({ tipo: 'PURCHASE_APPROVED', codigo: 'AAA111', correo: 'a@sano.com', hace: 30, tenantId: 't1' }),
        evento({ tipo: 'PURCHASE_COMPLETE', codigo: 'AAA111', correo: 'a@sano.com', hace: 23, tenantId: 't1' }),
        evento({ tipo: 'PURCHASE_APPROVED', codigo: 'AAA111', correo: 'a@sano.com', hace: 1, tenantId: 't1' }),
      ],
      negocios: [sano],
      ahora: AHORA,
    });
    expect(alertas).toEqual([]);
  });

  it('un negocio en mora con su ÚNICA suscripción no es esta alerta (eso lo lleva el ciclo de cobro)', () => {
    const n: NegocioParaAlertas = { id: 't1', brandName: 'Mora', email: 'a@mora.com', hotmartSubscriberCode: 'M1' };
    const alertas = detectarAlertasDeSuscripcion({
      eventos: [evento({ tipo: 'PURCHASE_DELAYED', codigo: 'M1', correo: 'a@mora.com', hace: 2, tenantId: 't1' })],
      negocios: [n],
      ahora: AHORA,
    });
    expect(alertas).toEqual([]);
  });

  it('eventos de OTRO producto del productor (Master Creativo, Automatización de WhatsApp) se ignoran', () => {
    const alertas = detectarAlertasDeSuscripcion({
      eventos: [
        evento({ tipo: 'PURCHASE_DELAYED', codigo: 'MC1', correo: 'x@gmail.com', hace: 3, producto: { id: 777, name: 'Master Creativo' } }),
        evento({ tipo: 'PURCHASE_APPROVED', codigo: 'WA1', correo: 'y@gmail.com', hace: 3, producto: { id: 888, name: 'Automatización de WhatsApp' } }),
        // El dueño de Macondo compró además el curso con su correo, y el
        // webhook lo casó por correo: no es una segunda suscripción.
        evento({ tipo: 'PURCHASE_APPROVED', codigo: 'MC2', correo: MACONDO.email!, hace: 5, tenantId: MACONDO.id, producto: { id: 777, name: 'Master Creativo' } }),
        evento({ tipo: 'PURCHASE_APPROVED', codigo: 'D99G58Q2', correo: MACONDO.email!, hace: 20, tenantId: MACONDO.id }),
      ],
      negocios: [MACONDO],
      ahora: AHORA,
    });
    expect(alertas).toEqual([]);
  });

  it('un producto sin «Clubify» en el nombre cuenta si lo paga un negocio vinculado (marcas blancas)', () => {
    const sellea = { id: 9, name: 'Plan Sellea' };
    const n: NegocioParaAlertas = { id: 't2', brandName: 'Tienda', email: 'a@tienda.com', hotmartSubscriberCode: 'S1' };
    const alertas = detectarAlertasDeSuscripcion({
      eventos: [
        evento({ tipo: 'PURCHASE_APPROVED', codigo: 'S1', correo: 'a@tienda.com', hace: 5, tenantId: 't2', producto: sellea }),
        evento({ tipo: 'PURCHASE_DELAYED', codigo: 'S9', correo: 'nadie@gmail.com', hace: 1, producto: sellea }),
      ],
      negocios: [n],
      ahora: AHORA,
    });
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toMatchObject({ tipo: 'SUSCRIPCION_HUERFANA', id: 'huerfana:S9', negocio: null, gravedad: 'alta' });
    expect(alertas[0].recomendacion).toContain('nadie@gmail.com');
  });

  it('packs de créditos, planes de cuponera y grupos empresariales no son huérfanos', () => {
    const alertas = detectarAlertasDeSuscripcion({
      eventos: [
        evento({ tipo: 'PURCHASE_APPROVED', codigo: 'CR1', correo: 'marca@gmail.com', hace: 2, producto: { id: 50, name: 'Créditos Clubify mensual' } }),
        evento({ tipo: 'PURCHASE_DELAYED', codigo: 'G1', correo: 'grupo@gmail.com', hace: 2 }),
      ],
      negocios: [],
      ahora: AHORA,
      productosAjenos: ['50'],
      codigosDeGrupos: ['G1'],
    });
    expect(alertas).toEqual([]);
  });

  it('una suscripción cancelada después de su último cobro ya no avisa', () => {
    const alertas = detectarAlertasDeSuscripcion({
      eventos: [
        evento({ tipo: 'PURCHASE_DELAYED', codigo: 'X1', correo: 'x@gmail.com', hace: 5 }),
        evento({ tipo: 'SUBSCRIPTION_CANCELLATION', codigo: 'X1', correo: 'x@gmail.com', hace: 4 }),
      ],
      negocios: [],
      ahora: AHORA,
    });
    expect(alertas).toEqual([]);
  });

  it('un primer pago que ya está en «Pagos sin activar» no se repite aquí', () => {
    const e = [evento({ tipo: 'PURCHASE_APPROVED', codigo: 'NUEVO', correo: 'nuevo@gmail.com', hace: 0 })];
    expect(detectarAlertasDeSuscripcion({ eventos: e, negocios: [], ahora: AHORA, codigosPendientesDeActivar: ['NUEVO'] })).toEqual([]);
    expect(detectarAlertasDeSuscripcion({ eventos: e, negocios: [], ahora: AHORA })).toHaveLength(1);
  });

  it('dos cobros al día para el mismo negocio: avisa que le cobramos dos veces', () => {
    const n: NegocioParaAlertas = { id: 't3', brandName: 'Doble', email: 'dueno@gmail.com', hotmartSubscriberCode: 'A1' };
    const [a] = detectarAlertasDeSuscripcion({
      eventos: [
        evento({ tipo: 'PURCHASE_APPROVED', codigo: 'A1', correo: 'dueno@gmail.com', hace: 10, tenantId: 't3' }),
        evento({ tipo: 'PURCHASE_APPROVED', codigo: 'B2', correo: 'dueno@gmail.com', hace: 3 }),
      ],
      negocios: [n],
      ahora: AHORA,
    });
    expect(a.tipo).toBe('DOBLE_SUSCRIPCION');
    expect(a.negocio?.vinculo).toBe('correo');
    expect(a.recomendacion).toContain('las dos están cobrando');
  });

  it('fuera de la ventana de 45 días no cuenta', () => {
    const alertas = detectarAlertasDeSuscripcion({
      eventos: [evento({ tipo: 'PURCHASE_DELAYED', codigo: 'VIEJO', correo: 'v@gmail.com', hace: 60 })],
      negocios: [],
      ahora: AHORA,
    });
    expect(alertas).toEqual([]);
  });

  it('el dominio solo cuenta si es propio', () => {
    expect(dominioDeEmpresa('a@gmail.com')).toBeNull();
    expect(dominioDeEmpresa('a@hotmail.es')).toBeNull();
    expect(dominioDeEmpresa('a@CafeMacondo.cl')).toBe('cafemacondo.cl');
  });
});

describe('alertasNuevas y textoDelResumen', () => {
  it('no repite lo ya avisado o revisado, y el SMS dice qué hacer', () => {
    const alertas = detectarAlertasDeSuscripcion({ eventos: eventosDeMacondo(), negocios: [MACONDO], ahora: AHORA });
    expect(alertasNuevas(alertas, ['doble:t-macondo:D99G58Q2+JSLQIK9H'])).toEqual([]);
    const nuevas = alertasNuevas(alertas, []);
    const texto = textoDelResumen(nuevas, 'https://app.soyclubify.com/admin');
    expect(texto).toContain('1 nueva');
    expect(texto).toContain('Cancelar en Hotmart la suscripción JSLQIK9H');
    expect(texto).toContain('https://app.soyclubify.com/admin');
  });
});

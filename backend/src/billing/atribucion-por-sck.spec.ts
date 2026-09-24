import { describe, it, expect } from 'vitest';
import { HotmartService } from './hotmart.service';
import { codigoDeOrigenDelPago, codigosDeOrigenDelPago } from './hotmart-src';

/**
 * Atribuir la venta al afiliado desde el propio pago de Hotmart.
 *
 * EL FALLO (arqueo del 2026-09-17, Habibi Bar Cantina y Master Sushi La Ligua,
 * los dos de Nicolas ¡TeamClosers!): la red de seguridad server-side NUNCA había
 * atribuido una venta. Los enlaces de pago llevaban `src=<CÓDIGO>` y el backend
 * lo buscaba en `purchase.tracking`. En producción, 0 de 353 avisos de Hotmart
 * traían `tracking`: en un checkout (`pay.hotmart.com`) Hotmart rastrea el
 * origen con `sck`, no con `src`, y lo devuelve en `purchase.origin`. Solo se
 * atribuía cuando el comprador pasaba por `/ref/...` en el mismo navegador; la
 * mitad de las primeras compras con afiliado de los últimos 60 días se tuvo que
 * asignar a mano.
 */

describe('dónde viene el código de origen en el pago', () => {
  it('purchase.origin.sck (checkout de Hotmart)', () => {
    expect(codigoDeOrigenDelPago({ data: { purchase: { origin: { sck: 'BGXM2QWQ' } } } })).toBe('BGXM2QWQ');
  });

  it('purchase.origin.xcod, .xcode y .src también valen', () => {
    expect(codigoDeOrigenDelPago({ data: { purchase: { origin: { xcod: 'TAFMPWK5' } } } })).toBe('TAFMPWK5');
    expect(codigoDeOrigenDelPago({ data: { purchase: { origin: { xcode: 'TAFMPWK5' } } } })).toBe('TAFMPWK5');
    expect(codigoDeOrigenDelPago({ data: { purchase: { origin: { src: 'TAFMPWK5' } } } })).toBe('TAFMPWK5');
  });

  it('devuelve TODOS los candidatos, lo nuestro (sck) antes que el xcod de Hotmart', () => {
    const payload = { data: { purchase: { sckPaymentLink: 'BGXM2QWQ', origin: { xcod: 'hotmart_mkt_123', src: 'BGXM2QWQ' } } } };
    expect(codigosDeOrigenDelPago(payload)).toEqual(['BGXM2QWQ', 'hotmart_mkt_123']);
  });

  it('sigue leyendo purchase.tracking por si alguna versión lo manda ahí', () => {
    expect(codigoDeOrigenDelPago({ data: { purchase: { tracking: { source_sck: 'ABCD1234' } } } })).toBe('ABCD1234');
  });

  it('el enlace de pago de Hotmart con sck (sckPaymentLink)', () => {
    expect(codigoDeOrigenDelPago({ data: { purchase: { sckPaymentLink: 'BGXM2QWQ' } } })).toBe('BGXM2QWQ');
  });

  it('si Hotmart lo mueve de sitio, lo encuentra igual dentro de data', () => {
    expect(codigoDeOrigenDelPago({ data: { purchase: { checkout: { sck: 'BGXM2QWQ' } } } })).toBe('BGXM2QWQ');
  });

  it('un pago sin código no se inventa uno (los 353 de producción)', () => {
    expect(codigoDeOrigenDelPago({ data: { purchase: { transaction: 'HP1', offer: { code: '04u23bz7' } }, product: { id: 1 } } })).toBeNull();
    expect(codigoDeOrigenDelPago(null)).toBeNull();
  });

  it('el origen con afiliado y marca combinados llega entero', () => {
    const wl = 'wl_dfd3cdff-7836-4aee-96a4-d7fa2b2907be';
    expect(codigoDeOrigenDelPago({ data: { purchase: { origin: { sck: `BGXM2QWQ-${wl}` } } } })).toBe(`BGXM2QWQ-${wl}`);
  });
});

describe('el webhook atribuye la venta al afiliado del sck', () => {
  function montar() {
    const creados: any[] = [];
    const prisma: any = {
      referralUse: {
        findFirst: async () => null,
        create: async ({ data }: any) => {
          creados.push(data);
          return data;
        },
      },
      referralCode: {
        findUnique: async ({ where }: any) =>
          where.code === 'BGXM2QWQ'
            ? { id: 'code-nicolas', isActive: true, ownerName: 'Nicolas ¡TeamClosers!', role: 'INFLUENCER' }
            : null,
        findFirst: async () => null,
      },
    };
    const svc: any = new HotmartService(
      prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { svc, creados };
  }

  it('Master Sushi: pago con origin.sck=BGXM2QWQ → uso de Nicolas', async () => {
    const { svc, creados } = montar();
    await svc.ensureAffiliateAttributionFromSrc('master-sushi', {
      event: 'PURCHASE_APPROVED',
      data: { purchase: { transaction: 'HP3487716259', origin: { sck: 'BGXM2QWQ' } } },
    });
    expect(creados).toHaveLength(1);
    expect(creados[0]).toMatchObject({ referralCodeId: 'code-nicolas', tenantId: 'master-sushi' });
  });

  it('un código ajeno por delante no tapa al del afiliado', async () => {
    const { svc, creados } = montar();
    await svc.ensureAffiliateAttributionFromSrc('master-sushi', {
      event: 'PURCHASE_APPROVED',
      data: { purchase: { origin: { sck: 'instagram_bio', src: 'BGXM2QWQ' } } },
    });
    expect(creados).toHaveLength(1);
    expect(creados[0].referralCodeId).toBe('code-nicolas');
  });

  it('sin código en el pago no atribuye a nadie', async () => {
    const { svc, creados } = montar();
    await svc.ensureAffiliateAttributionFromSrc('habibi', { event: 'PURCHASE_APPROVED', data: { purchase: { transaction: 'HP1040851171' } } });
    expect(creados).toHaveLength(0);
  });
});

import { describe, it, expect } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PassesService } from './passes.service';
import { StampsService } from '../stamps/stamps.service';
import { ScannerService } from '../scanner/scanner.service';
import { GoogleWalletService } from '../wallet/google-wallet.service';

/**
 * La Tarjeta Informativa (CardType.INFO): una credencial que NO acumula nada.
 *
 * Todo lo que se prueba acá son puertas que ya estaban ABIERTAS para el club y
 * las alianzas y que hubo que cerrar una por una cuando ya estaban en
 * producción. Aquí se cierran antes de que exista la primera tarjeta.
 */

const nada = () => ({}) as any;

const TARJETA_INFO = {
  id: 'c-info',
  type: 'INFO',
  name: 'Credencial DeGodoy',
  rewardText: null,
  stampsRequired: null,
  convenioId: null,
  clubPlanId: null,
  primaryColor: '#000000',
};

// ---------------------------------------------------------------------------
// 1. El cajero no la puede sellar
// ---------------------------------------------------------------------------

describe('sellar una tarjeta informativa', () => {
  const servicioDeSellos = (card: Record<string, unknown>) => {
    const prisma: any = {
      pass: {
        findUnique: async () => ({
          id: 'p1',
          tenantId: 't1',
          status: 'ACTIVE',
          stampsCount: 0,
          card,
        }),
      },
    };
    return new StampsService(
      prisma, nada(), nada(), nada(), nada(), nada(), nada(),
    );
  };
  const cajero: any = { id: 'u1', role: 'TENANT_STAFF', tenantId: 't1' };

  it('se rechaza — si no, subiría un contador que el cliente no ve', async () => {
    const svc = servicioDeSellos(TARJETA_INFO);
    await expect(
      svc.record(cajero, { passId: 'p1' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('y el motivo se lee en español, que es quien lo va a leer', async () => {
    const svc = servicioDeSellos(TARJETA_INFO);
    await expect(svc.record(cajero, { passId: 'p1' } as any)).rejects.toThrow(
      /informativa.*no acumula sellos/s,
    );
  });

  it('EL GATE MIRA EL TIPO, no un campo colgado', async () => {
    // Si alguien «arregla» esto comprobando `convenioId`/`clubPlanId` como los
    // dos gates de arriba, esta prueba se pone en rojo: una INFO limpia, sin
    // ningún campo especial, tiene que seguir rechazándose.
    const limpia = { ...TARJETA_INFO, convenioId: null, clubPlanId: null };
    await expect(
      servicioDeSellos(limpia).record(cajero, { passId: 'p1' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('la prueba sabe ponerse en ROJO: una de sellos NO se rechaza por esto', async () => {
    const sellos = { ...TARJETA_INFO, type: 'STAMPS', stampsRequired: 10 };
    await expect(
      servicioDeSellos(sellos).record(cajero, { passId: 'p1' } as any),
    ).rejects.not.toThrow(/informativa/);
  });
});

// ---------------------------------------------------------------------------
// 2. El escáner la manda a su propia pantalla
// ---------------------------------------------------------------------------

describe('escanear una tarjeta informativa', () => {
  const escaner = (card: Record<string, unknown>) => {
    const elPase = {
      id: 'p1',
      tenantId: 't1',
      status: 'ACTIVE',
      card,
      customer: { id: 'cli1', fullName: 'Ana' },
      tenant: { brandName: 'DeGodoy', whiteLabel: null },
    };
    const prisma: any = {
      // El escáner resuelve el QR por `findUnique({ qrToken })`, que es lo que
      // le deja saltarse el verify de JWT en el caso normal.
      pass: { findUnique: async () => elPase, findFirst: async () => elPase },
      stamp: { findMany: async () => [] },
    };
    return new ScannerService(nada(), prisma, nada(), nada(), nada(), nada());
  };
  const cajero: any = { id: 'u1', role: 'TENANT_STAFF', tenantId: 't1' };

  it('devuelve kind «info», NO «sellos»', async () => {
    const r: any = await escaner(TARJETA_INFO).verifyQr(cajero, 'QR-loquesea');
    expect(r.kind).toBe('info');
  });

  it('EL FALLO QUE SE EVITA: sin la rama, todo lo que no es cupón cae en sellos', async () => {
    // Esta es la línea de la que hay que cuidarse:
    //   const kind = pass.card.type === 'COUPON' ? 'cupon' : 'sellos';
    // Con ella y sin el desvío, el cajero vería el botón de sellar.
    const r: any = await escaner(TARJETA_INFO).verifyQr(cajero, 'QR-loquesea');
    expect(r.kind).not.toBe('sellos');
  });

  it('y no se consulta el historial de sellos de algo que no tiene sellos', async () => {
    const r: any = await escaner(TARJETA_INFO).verifyQr(cajero, 'QR-loquesea');
    expect(r.recent).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. El pase no promete «0/10»
// ---------------------------------------------------------------------------

describe('lo que enseña el pase de Google', () => {
  const balance = (pass: Record<string, unknown>) =>
    (new GoogleWalletService(nada(), nada()) as any).buildBalance(pass);

  const pase = (extra: Record<string, unknown> = {}) => ({
    status: 'ACTIVE',
    stampsCount: 0,
    customer: { locale: 'es' },
    tenant: { locale: 'es' },
    card: TARJETA_INFO,
    ...extra,
  });

  it('NO dice 0/10 — el fallo que ya tuvieron el club y la alianza', () => {
    const r = balance(pase());
    expect(r.balance.string).not.toMatch(/\//);
    expect(r.label).not.toMatch(/SELLOS/i);
  });

  it('sin texto del negocio, dice ACTIVA', () => {
    expect(balance(pase()).balance.string).toBe('ACTIVA');
  });

  it('CON texto del negocio, manda el suyo — esto es lo que la hace genérica', () => {
    const r = balance(
      pase({ card: { ...TARJETA_INFO, rewardText: 'Cliente distinguido' } }),
    );
    expect(r.balance.string).toBe('Cliente distinguido');
  });

  it('revocada gana SIEMPRE, por bonito que sea el texto del negocio', () => {
    const r = balance(
      pase({
        status: 'REVOKED',
        card: { ...TARJETA_INFO, rewardText: 'Cliente distinguido' },
      }),
    );
    expect(r.balance.string).toBe('DESACTIVADA');
  });

  it('la prueba sabe ponerse en ROJO: una de sellos SÍ dice 0/10', () => {
    const r = balance(
      pase({ card: { ...TARJETA_INFO, type: 'STAMPS', stampsRequired: 10 } }),
    );
    expect(r.balance.string).toBe('0/10');
  });
});

// ---------------------------------------------------------------------------
// 4. Revocar: atómico, aislado por negocio, y sin borrar al cliente
// ---------------------------------------------------------------------------

describe('revocar un pase', () => {
  function servicio(opts: { count?: number; status?: string } = {}) {
    const llamadas: any[] = [];
    const borrados: any[] = [];
    const prisma: any = {
      pass: {
        findFirst: async () => ({
          id: 'p1',
          tenantId: 't1',
          serialNumber: 'CLB-abc',
          status: opts.status ?? 'ACTIVE',
          customerId: 'cli1',
          card: { name: 'Credencial', type: 'INFO' },
        }),
        updateMany: async (args: any) => {
          llamadas.push(args);
          return { count: opts.count ?? 1 };
        },
        delete: async (a: any) => borrados.push(['pass', a]),
      },
      customer: {
        delete: async (a: any) => borrados.push(['customer', a]),
        update: async (a: any) => borrados.push(['customer.update', a]),
      },
    };
    const auditoria: any = { log: async (a: any) => llamadas.push({ audit: a }) };
    const srv = new PassesService(prisma, nada(), nada(), nada(), auditoria);
    return { srv, llamadas, borrados };
  }
  const dueño: any = { id: 'u1', role: 'TENANT_OWNER', tenantId: 't1' };

  it('escribe con updateMany CONDICIONAL, no con un update a secas', async () => {
    const { srv, llamadas } = servicio();
    await srv.revocar(dueño, 'p1');
    const [w] = llamadas;
    // Atómico: la condición viaja DENTRO del where. Sin esto, dos clics a la
    // vez revocan dos veces y el segundo pisa la fecha y el autor del primero.
    expect(w.where.status).toEqual({ not: 'REVOKED' });
    // Aislado: el middleware de Prisma NO cubre `update` singular, así que el
    // tenantId tiene que ir explícito en el where.
    expect(w.where.tenantId).toBe('t1');
    expect(w.data.status).toBe('REVOKED');
  });

  it('deja quién y cuándo en la propia fila, no solo en auditoría', async () => {
    const { srv, llamadas } = servicio();
    await srv.revocar(dueño, 'p1');
    expect(llamadas[0].data.revokedBy).toBe('u1');
    expect(llamadas[0].data.revokedAt).toBeInstanceOf(Date);
  });

  it('toca lastActivityAt — si no, Apple sigue sirviendo su copia cacheada', async () => {
    const { srv, llamadas } = servicio();
    await srv.revocar(dueño, 'p1');
    expect(llamadas[0].data.lastActivityAt).toBeInstanceOf(Date);
  });

  it('NO BORRA AL CLIENTE: retirar una credencial no es echar a una persona', async () => {
    const { srv, borrados } = servicio();
    await srv.revocar(dueño, 'p1');
    expect(borrados).toEqual([]);
  });

  it('revocar dos veces no miente: si no cambió nada, avisa', async () => {
    const { srv } = servicio({ count: 0 });
    await expect(srv.revocar(dueño, 'p1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('un negocio no revoca el pase de otro', async () => {
    const { srv } = servicio();
    const ajeno: any = { id: 'u9', role: 'TENANT_OWNER', tenantId: 'OTRO' };
    await expect(srv.revocar(ajeno, 'p1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('restaurar existe: revocar no puede ser un viaje de ida', async () => {
    const { srv, llamadas } = servicio({ status: 'REVOKED' });
    await srv.restaurar(dueño, 'p1');
    expect(llamadas[0].where.status).toBe('REVOKED');
    expect(llamadas[0].data.status).toBe('ACTIVE');
    expect(llamadas[0].data.revokedAt).toBeNull();
  });
});

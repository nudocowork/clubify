import { describe, it, expect } from 'vitest';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { WalletService } from '../wallet/wallet.service';
import type { QueueService } from '../jobs/queue.service';
import type { GamificationService } from '../badges/gamification.service';
import type { AutomationsService } from '../automations/automations.service';
import type { PassesService } from '../passes/passes.service';
import type { WhitelabelBrandService } from '../whitelabel/whitelabel-brand.service';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { StampsService } from './stamps.service';
import {
  bdVacia,
  crearDobles,
  crearPrismaFalso,
  pase,
  tarjeta,
  type BaseDeDatos,
  type FilaPase,
} from './stamps-prisma-falso';

/**
 * Canjear un cupón cuando el cliente YA tenía tarjeta de sellos, contra el
 * SERVICIO REAL.
 *
 * El defecto: el pase del cupón se quedaba con la tarjeta de sellos y el pase
 * de sellos que el cliente ya tenía se BORRABA. Se conservaba el número, pero
 * la cascada se llevaba su historial de `Stamp` (con los montos de compra) y
 * sus registros de Apple, y su QR no se guardaba en `legacyQrTokens` como sí
 * hace la fusión de clientes. La tarjeta que el cliente llevaba en el teléfono
 * quedaba muerta y el escáner decía «Pase no encontrado». En producción, 15
 * pases de 7 negocios con un contador que su propio historial no explica.
 */

const CAJERO: AuthUser = {
  id: 'u1',
  email: 'caja@negocio.test',
  role: 'TENANT_STAFF' as AuthUser['role'],
  tenantId: 't1',
};

function montar(bd: BaseDeDatos) {
  const falso = crearPrismaFalso(bd);
  const d = crearDobles();
  const svc = new StampsService(
    falso.prisma as unknown as PrismaService,
    d.wallet as unknown as WalletService,
    d.jobs as unknown as QueueService,
    d.gamification as unknown as GamificationService,
    d.automations as unknown as AutomationsService,
    d.passes as unknown as PassesService,
    d.brand as unknown as WhitelabelBrandService,
  );
  return { svc, d };
}

/** Negocio con tarjeta de sellos (tope 10) y un cupón de bienvenida. */
function negocio(): BaseDeDatos {
  const bd = bdVacia();
  bd.tenants.push({ id: 't1', maxStampsPerDay: 1 });
  bd.clientes.push({ id: 'cli1', tenantId: 't1', fullName: 'Cliente' });
  bd.tarjetas.push(
    tarjeta({ id: 'sellos', type: 'STAMPS', stampsRequired: 10 }),
    tarjeta({ id: 'cupon', type: 'COUPON', createdAt: new Date('2026-02-01T00:00:00Z') }),
  );
  bd.pases.push(pase({ id: 'cupon-p', cardId: 'cupon', legacyQrTokens: ['QR-cupon-viejo'] }));
  return bd;
}

/** La tarjeta de sellos que el cliente ya tenía: 4 sellos con su compra. */
function conSellosPrevios(bd: BaseDeDatos, extra: Partial<FilaPase> = {}) {
  bd.pases.push(
    pase({
      id: 'sellos-p',
      cardId: 'sellos',
      stampsCount: 4,
      legacyQrTokens: ['QR-sellos-fusionado'],
      ...extra,
    }),
  );
  for (let i = 0; i < 4; i++) {
    bd.sellos.push({
      id: `s${i}`,
      tenantId: 't1',
      passId: 'sellos-p',
      customerId: 'cli1',
      action: 'STAMP',
      amount: 1,
      purchaseAmount: 25000,
      redeemKind: null,
      note: null,
      createdAt: new Date(`2026-08-0${i + 1}T15:00:00Z`),
    });
  }
}

const idsDeSellos = (bd: BaseDeDatos, passId: string) =>
  bd.sellos.filter((s) => s.passId === passId).map((s) => s.id);

describe('sin tarjeta de sellos previa: la conversión de siempre', () => {
  it('el cupón se transforma in-place (mismo id y QR), 0 sellos, ACTIVE', async () => {
    const bd = negocio();
    const { svc } = montar(bd);

    const r = await svc.record(CAJERO, { passId: 'cupon-p', action: 'REDEEM' });

    expect(bd.pases).toHaveLength(1);
    expect(bd.pases[0]).toMatchObject({
      id: 'cupon-p',
      cardId: 'sellos',
      stampsCount: 0,
      status: 'ACTIVE',
      qrToken: 'QR-cupon-p',
    });
    expect(r.transformedToStamps).toBe(true);
  });
});

describe('tarjeta de sellos previa que el cliente NO instaló: sobrevive el cupón', () => {
  it('conserva los sellos, el HISTORIAL y el QR viejo', async () => {
    const bd = negocio();
    conSellosPrevios(bd);
    const { svc } = montar(bd);

    await svc.record(CAJERO, { passId: 'cupon-p', action: 'REDEEM' });

    expect(bd.pases.map((p) => p.id)).toEqual(['cupon-p']);
    const queda = bd.pases[0];
    expect(queda).toMatchObject({ cardId: 'sellos', stampsCount: 4, status: 'ACTIVE' });
    // El historial con sus montos: se MUEVE, no se lo lleva la cascada.
    expect(idsDeSellos(bd, 'cupon-p')).toEqual(expect.arrayContaining(['s0', 's1', 's2', 's3']));
    expect(
      bd.sellos.filter((s) => s.passId === 'cupon-p' && s.purchaseAmount === 25000),
    ).toHaveLength(4);
    // El QR de la tarjeta borrada (y los que ella heredó) siguen escaneando.
    expect(queda.legacyQrTokens).toEqual(
      expect.arrayContaining(['QR-cupon-viejo', 'QR-sellos-p', 'QR-sellos-fusionado']),
    );
    expect(queda.legacyQrTokens).not.toContain(queda.qrToken);
  });

  it('si el cartón previo estaba lleno, el superviviente queda COMPLETED sin volver a avisar', async () => {
    const bd = negocio();
    conSellosPrevios(bd, { stampsCount: 10, status: 'COMPLETED' });
    const { svc, d } = montar(bd);

    await svc.record(CAJERO, { passId: 'cupon-p', action: 'REDEEM' });

    expect(bd.pases[0]).toMatchObject({ id: 'cupon-p', stampsCount: 10, status: 'COMPLETED' });
    expect(d.eventos.filter((e) => e.tipo === 'PASS_COMPLETED')).toHaveLength(0);
  });
});

describe('tarjeta de sellos previa INSTALADA: sobrevive la de sellos', () => {
  it('Apple (dispositivo registrado): el pase de sellos queda intacto y absorbe el cupón', async () => {
    const bd = negocio();
    conSellosPrevios(bd);
    bd.dispositivos.push({ id: 'd1', passId: 'sellos-p', deviceLibraryId: 'iphone' });
    const { svc, d } = montar(bd);

    const r = await svc.record(CAJERO, { passId: 'cupon-p', action: 'REDEEM' });

    expect(bd.pases.map((p) => p.id)).toEqual(['sellos-p']);
    const queda = bd.pases[0];
    expect(queda).toMatchObject({
      cardId: 'sellos',
      stampsCount: 4,
      status: 'ACTIVE',
      serialNumber: 'SER-sellos-p',
      qrToken: 'QR-sellos-p',
    });
    // Su registro de Apple sigue ahí: el teléfono sigue recibiendo avisos.
    expect(bd.dispositivos).toEqual([{ id: 'd1', passId: 'sellos-p', deviceLibraryId: 'iphone' }]);
    // Historial intacto + el canje del cupón apuntado en él, como COUPON.
    expect(idsDeSellos(bd, 'sellos-p')).toEqual(expect.arrayContaining(['s0', 's1', 's2', 's3']));
    const canje = bd.sellos.find((s) => s.action === 'REDEEM');
    expect(canje).toMatchObject({ passId: 'sellos-p', redeemKind: 'COUPON' });
    // El QR del cupón (y el que el cupón heredó) escanean y llevan a esta tarjeta.
    expect(queda.legacyQrTokens).toEqual(
      expect.arrayContaining(['QR-sellos-fusionado', 'QR-cupon-p', 'QR-cupon-viejo']),
    );

    // Todo lo de después apunta al que queda, no al pase borrado.
    expect((r.pass as { id: string }).id).toBe('sellos-p');
    expect(r.transformedToStamps).toBe(true);
    expect(d.empujes.map((e) => e.passId)).toEqual(['sellos-p']);
    const cupon = d.eventos.find((e) => e.tipo === 'COUPON_REDEEMED');
    expect(cupon?.payload).toMatchObject({
      couponPassId: 'cupon-p',
      stampsPassId: 'sellos-p',
      stampsPassUrl: 'https://marca.test/w/sellos-p',
    });
  });

  it('Google (walletInstalledAt): también sobrevive la de sellos', async () => {
    const bd = negocio();
    conSellosPrevios(bd, { walletInstalledAt: new Date('2026-07-01T00:00:00Z') });
    const { svc } = montar(bd);

    await svc.record(CAJERO, { passId: 'cupon-p', action: 'REDEEM' });

    expect(bd.pases.map((p) => p.id)).toEqual(['sellos-p']);
    expect(bd.pases[0].stampsCount).toBe(4);
  });

  it('el mismo cupón no se puede canjear dos veces', async () => {
    const bd = negocio();
    conSellosPrevios(bd, { walletInstalledAt: new Date('2026-07-01T00:00:00Z') });
    const { svc } = montar(bd);

    const [a, b] = await Promise.allSettled([
      svc.record(CAJERO, { passId: 'cupon-p', action: 'REDEEM' }),
      svc.record(CAJERO, { passId: 'cupon-p', action: 'REDEEM' }),
    ]);

    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
    expect(bd.sellos.filter((s) => s.action === 'REDEEM')).toHaveLength(1);
    expect(bd.pases.map((p) => p.id)).toEqual(['sellos-p']);
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { ConveniosCanjeService } from './convenios-canje.service';
import { escenario, type Fila, type PrismaFalso } from './alianzas-prisma-falso';

/**
 * El canje en caja: `ConveniosCanjeService`, el de verdad, contra el doble de
 * Prisma en memoria.
 *
 * `canje.spec.ts` (el viejo) copia `calcularDescuento` dentro del propio
 * fichero de test y prueba la copia: si el servicio cambiara de fórmula,
 * aquel test seguiría en verde. Este ejercita el servicio.
 *
 * Lo que importa aquí es distinto de lo que importa en el portal: hay un
 * cliente delante del mostrador. Toda la validación se repite dentro del
 * candado —entre que el cajero mira la pantalla y pulsa, el dueño pudo apagar
 * el cupón— y una anulación pulsada dos veces no puede descontar dos.
 */

beforeAll(() => {
  Logger.overrideLogger([]);
});

const CAJERO = {
  id: 'user-caja',
  email: 'caja@cafeluna.co',
  role: 'OWNER',
  tenantId: 'tenant-cafe',
} as unknown as AuthUser;

/** Monta negocio + convenio + cupón + un empleado con su tarjeta y su pase. */
function montar(op: Parameters<typeof escenario>[0] = {}) {
  const e = escenario(op);
  const svc = new ConveniosCanjeService(e.prisma);
  const customer = e.db.sembrar('customer', {
    tenantId: 'tenant-cafe',
    fullName: 'Ana Pérez',
    phone: '+573001112233',
  });
  const card = e.db.sembrar('card', {
    tenantId: 'tenant-cafe',
    convenioId: 'convenio-confe',
  });
  const pass = e.db.sembrar('pass', {
    tenantId: 'tenant-cafe',
    cardId: card.id,
    customerId: customer.id,
    serialNumber: 'CLB-1',
    qrToken: 'QR-1',
    authToken: 'x',
  });
  const tarjeta = e.db.sembrar('convenioTarjeta', {
    convenioId: 'convenio-confe',
    customerId: customer.id,
    passId: pass.id,
    documento: '10203045',
  });
  return { ...e, svc, customer, card, pass, tarjeta };
}

function canjear(
  svc: ConveniosCanjeService,
  tarjetaId: string,
  extra: Fila = {},
) {
  return svc.canjear(CAJERO, {
    tarjetaId,
    cuponId: 'cupon-10',
    locationId: null,
    compraMonto: null,
    ...extra,
  });
}

/** Siembra un canje ya hecho, con el contador del cupón al día. */
function canjePrevio(db: PrismaFalso, tarjetaId: string, extra: Fila = {}): Fila {
  const canje = db.sembrar('convenioCanje', {
    convenioId: 'convenio-confe',
    cuponId: 'cupon-10',
    tarjetaId,
    operatorUserId: CAJERO.id,
    ...extra,
  });
  const cupon = db.tabla('convenioCupon')[0];
  if (!extra.revertedAt) cupon.canjesCount += 1;
  return canje;
}

describe('registrar el canje', () => {
  it('lo guarda, sube el contador y dice qué aplicar', async () => {
    const { svc, db, tarjeta } = montar();

    const r = await canjear(svc, tarjeta.id, { compraMonto: 50_000 });

    expect(r.ok).toBe(true);
    expect(r.titular).toBe('Ana Pérez');
    expect(r.aplicar).toBe('Aplicar 10% de descuento');
    // El descuento lo calcula el SERVIDOR, nunca el formulario de la caja.
    expect(r.descuentoMonto).toBe(5_000);
    expect(db.tabla('convenioCanje')).toHaveLength(1);
    expect(db.tabla('convenioCupon')[0].canjesCount).toBe(1);
    expect(r.anulableHasta.getTime()).toBeGreaterThan(Date.now());
  });

  it('pide el candado del cupón antes de contar', async () => {
    // Sin el candado, dos cajas escaneando a la vez leen el mismo conteo y las
    // dos pasan — que es justo lo que un tope de «1 por día» debe impedir.
    const { svc, db, tarjeta } = montar();
    await canjear(svc, tarjeta.id);
    expect(db.candados).toContain('convenio-canje:cupon-10');
  });

  it('un canje de convenio NO suma sellos: son sistemas separados', async () => {
    const { svc, db, tarjeta } = montar();
    await canjear(svc, tarjeta.id, { compraMonto: 50_000 });
    // El pase no se toca: una alianza es un vale permanente, no acumula nada.
    expect(db.tabla('pass')[0].stampsCount).toBe(0);
    expect(db.tabla('pass')[0].lastActivityAt).toBeNull();
  });

  it('sin el total del tiquete el porcentaje no se puede poner en pesos', async () => {
    const { svc, tarjeta } = montar();
    const r = await canjear(svc, tarjeta.id, { compraMonto: null });
    // El informe cuenta canjes, no pesos. Es el motivo de pedir el monto.
    expect(r.descuentoMonto).toBeNull();
  });

  it('el tope en pesos manda sobre el porcentaje', async () => {
    const { svc, tarjeta } = montar({ cupon: { topeDescuento: 20_000 } });
    const r = await canjear(svc, tarjeta.id, { compraMonto: 900_000 });
    expect(r.descuentoMonto).toBe(20_000);
  });

  it('un monto fijo nunca descuenta más que la compra', async () => {
    const { svc, tarjeta } = montar({
      cupon: { tipo: 'AMOUNT_OFF', valor: 10_000 },
    });
    const r = await canjear(svc, tarjeta.id, { compraMonto: 4_000 });
    expect(r.descuentoMonto).toBe(4_000);
  });
});

describe('lo que tumba un canje en el mostrador', () => {
  it('la tarjeta bloqueada', async () => {
    const { svc, db, tarjeta } = montar();
    db.tabla('convenioTarjeta')[0].status = 'BLOCKED';

    await expect(canjear(svc, tarjeta.id)).rejects.toThrow(
      /beneficio bloqueado/,
    );
    expect(db.tabla('convenioCanje')).toHaveLength(0);
  });

  it('el interruptor del ALIADO, aunque el negocio lo tenga encendido', async () => {
    const { svc, tarjeta } = montar({ cupon: { activoAliado: false } });
    await expect(canjear(svc, tarjeta.id)).rejects.toThrow(
      'Beneficio apagado por la empresa aliada.',
    );
  });

  it('el interruptor del NEGOCIO gana el mensaje si están los dos apagados', async () => {
    // Es el accionable para quien tiene al cliente delante: puede llamar a su
    // dueño, no a la empresa aliada.
    const { svc, tarjeta } = montar({
      cupon: { isActive: false, activoAliado: false },
    });
    await expect(canjear(svc, tarjeta.id)).rejects.toThrow(
      'Beneficio apagado por el negocio.',
    );
  });

  it('el convenio en pausa o finalizado', async () => {
    for (const status of ['PAUSED', 'FINISHED'] as const) {
      const { svc, tarjeta } = montar({ status });
      await expect(canjear(svc, tarjeta.id)).rejects.toThrow(
        BadRequestException,
      );
    }
  });

  it('el módulo de convenios apagado desde el panel de admin', async () => {
    // Apagar el módulo tiene que apagarlo de verdad. Antes solo se comprobaba
    // al CREAR un convenio, así que el negocio creía haberlo apagado y seguía
    // canjeando.
    const { svc, tarjeta } = montar({ conveniosEnabled: false });
    await expect(canjear(svc, tarjeta.id)).rejects.toThrow(
      'Los convenios de este negocio están desactivados.',
    );
  });

  it('el tope global agotado, sin dejar el contador tocado', async () => {
    const { svc, db, tarjeta } = montar({ cupon: { maxTotal: 1 } });
    canjePrevio(db, tarjeta.id);

    await expect(canjear(svc, tarjeta.id)).rejects.toThrow(/Se agotaron/);
    expect(db.tabla('convenioCupon')[0].canjesCount).toBe(1);
    expect(db.tabla('convenioCanje')).toHaveLength(1);
  });

  it('el tope por persona', async () => {
    const { svc, db, tarjeta } = montar({
      cupon: { maxPorPersona: 1, periodo: 'DIA' },
    });
    await canjear(svc, tarjeta.id);

    await expect(canjear(svc, tarjeta.id)).rejects.toThrow(
      'Podrá volver a usarlo mañana.',
    );
    expect(db.tabla('convenioCanje')).toHaveLength(1);
  });

  it('la compra mínima: primero pide el total, luego lo compara', async () => {
    const { svc, tarjeta } = montar({ cupon: { compraMinima: 30_000 } });

    await expect(canjear(svc, tarjeta.id, { compraMonto: null })).rejects.toThrow(
      /Escribe el total del tiquete/,
    );
    await expect(
      canjear(svc, tarjeta.id, { compraMonto: 29_999 }),
    ).rejects.toThrow(/La compra mínima es/);

    const r = await canjear(svc, tarjeta.id, { compraMonto: 30_000 });
    expect(r.ok).toBe(true);
  });

  it('la sede donde el convenio no aplica', async () => {
    const { svc, db, tarjeta } = montar();
    db.sembrar('convenioSede', {
      convenioId: 'convenio-confe',
      locationId: 'sede-centro',
    });

    await expect(
      canjear(svc, tarjeta.id, { locationId: 'sede-norte' }),
    ).rejects.toThrow('Este convenio no aplica en esta sede.');
    const r = await canjear(svc, tarjeta.id, { locationId: 'sede-centro' });
    expect(r.ok).toBe(true);
  });

  it('una tarjeta de otro negocio', async () => {
    const { svc, tarjeta } = montar();
    const ajeno = { ...CAJERO, tenantId: 'tenant-otro' } as AuthUser;
    await expect(
      svc.canjear(ajeno, { tarjetaId: tarjeta.id, cuponId: 'cupon-10' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('un cupón que no es de ese convenio', async () => {
    const { svc, db, tarjeta } = montar();
    const otro = db.sembrar('convenio', {
      tenantId: 'tenant-cafe',
      slug: 'otro',
      reportToken: 'r2',
      aliadoToken: 'a2',
    });
    const ajeno = db.sembrar('convenioCupon', { convenioId: otro.id });

    await expect(
      svc.canjear(CAJERO, { tarjetaId: tarjeta.id, cuponId: ajeno.id }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('lo que ve el cajero al escanear', () => {
  it('un pase que no es de convenio se dice claro', async () => {
    const { svc } = montar();
    await expect(svc.resolverParaCaja(CAJERO, 'pass-cualquiera')).rejects.toThrow(
      'Esta tarjeta no es de un convenio.',
    );
  });

  it('enseña solo los últimos 4 del documento', async () => {
    // Basta para cotejar con la cédula que muestre la persona y no expone el
    // número entero en la pantalla de la caja.
    const { svc, pass } = montar();
    const vista = await svc.resolverParaCaja(CAJERO, pass.id);
    expect(vista.titular.documento4).toBe('3045');
    expect(JSON.stringify(vista)).not.toContain('10203045');
  });

  it('muestra los cupones NO disponibles con su motivo, no los esconde', async () => {
    // Si se escondieran, el cajero creería que el escáner falla.
    const { svc, db, pass } = montar({ cupon: { activoAliado: false } });
    db.sembrar('convenioCupon', {
      convenioId: 'convenio-confe',
      name: 'Postre gratis',
      tipo: 'FREEBIE',
      position: 2,
    });

    const vista = await svc.resolverParaCaja(CAJERO, pass.id);

    expect(vista.cupones).toHaveLength(2);
    expect(vista.cupones[0]).toMatchObject({
      disponible: false,
      motivo: 'Beneficio apagado por la empresa aliada.',
    });
    expect(vista.cupones[1]).toMatchObject({
      disponible: true,
      motivo: null,
      aplicar: 'Entregar gratis: Postre gratis',
    });
  });

  it('el motivo global se dice UNA vez y tapa a todos los cupones', async () => {
    const { svc, pass } = montar({ conveniosEnabled: false });
    const vista = await svc.resolverParaCaja(CAJERO, pass.id);
    expect(vista.motivoGlobal).toBe(
      'Los convenios de este negocio están desactivados.',
    );
    expect(vista.cupones.every((c) => !c.disponible)).toBe(true);
  });

  it('el tope por persona ya gastado sale como no disponible', async () => {
    const { svc, db, pass, tarjeta } = montar({
      cupon: { maxPorPersona: 1, periodo: 'SIEMPRE' },
    });
    canjePrevio(db, tarjeta.id);

    const vista = await svc.resolverParaCaja(CAJERO, pass.id);

    expect(vista.cupones[0].disponible).toBe(false);
    expect(vista.cupones[0].topeTexto).toBe('Una sola vez');
  });
});

describe('anular — el defecto del doble clic', () => {
  it('una anulación marca el canje y descuenta el contador', async () => {
    const { svc, db, tarjeta } = montar();
    const canje = canjePrevio(db, tarjeta.id);

    const r = await svc.anular(CAJERO, canje.id);

    expect(r.ok).toBe(true);
    const guardado = db.tabla('convenioCanje')[0];
    expect(guardado.revertedAt).toBeInstanceOf(Date);
    expect(guardado.revertedBy).toBe(CAJERO.id);
    // No se borra: queda el rastro de quién anuló y cuándo.
    expect(db.tabla('convenioCanje')).toHaveLength(1);
    expect(db.tabla('convenioCupon')[0].canjesCount).toBe(0);
  });

  it('anular DOS VECES seguidas descuenta UNA sola vez', async () => {
    const { svc, db, tarjeta } = montar();
    const canje = canjePrevio(db, tarjeta.id);

    await svc.anular(CAJERO, canje.id);
    await expect(svc.anular(CAJERO, canje.id)).rejects.toThrow(
      'Este canje ya estaba anulado.',
    );

    expect(db.tabla('convenioCupon')[0].canjesCount).toBe(0);
  });

  it('el doble clic SIMULTÁNEO tampoco descuenta dos veces', async () => {
    // Este es el defecto de verdad, y el motivo de que el UPDATE sea
    // condicional: los dos clics pasan por el `if (canje.revertedAt)` antes de
    // que ninguno escriba, y con un `update` a secas el contador bajaba DOS
    // veces por una sola anulación, regalando un canje del tope global.
    const { svc, db, tarjeta } = montar({ cupon: { maxTotal: 5 } });
    const canje = canjePrevio(db, tarjeta.id);
    expect(db.tabla('convenioCupon')[0].canjesCount).toBe(1);

    const resultados = await Promise.allSettled([
      svc.anular(CAJERO, canje.id),
      svc.anular(CAJERO, canje.id),
    ]);

    const ganadores = resultados.filter((r) => r.status === 'fulfilled');
    expect(ganadores).toHaveLength(1);
    expect(db.tabla('convenioCupon')[0].canjesCount).toBe(0);
    expect(db.tabla('convenioCanje').filter((c) => c.revertedAt)).toHaveLength(1);
  });

  it('un canje anulado deja de contar para el tope por persona', async () => {
    const { svc, db, tarjeta } = montar({ cupon: { maxPorPersona: 1 } });
    const primero = await canjear(svc, tarjeta.id);
    await expect(canjear(svc, tarjeta.id)).rejects.toThrow(
      BadRequestException,
    );

    await svc.anular(CAJERO, primero.canjeId);

    const segundo = await canjear(svc, tarjeta.id);
    expect(segundo.ok).toBe(true);
    expect(db.tabla('convenioCupon')[0].canjesCount).toBe(1);
  });

  it('pasada la ventana de 10 minutos ya no se puede anular', async () => {
    const { svc, db, tarjeta } = montar();
    const canje = canjePrevio(db, tarjeta.id, {
      createdAt: new Date(Date.now() - 11 * 60_000),
    });

    await expect(svc.anular(CAJERO, canje.id)).rejects.toThrow(
      /Solo se puede anular dentro de los 10 minutos/,
    );
    expect(db.tabla('convenioCupon')[0].canjesCount).toBe(1);
  });

  it('un SUPER_ADMIN sí puede anular fuera de la ventana', async () => {
    const { svc, db, tarjeta } = montar();
    const canje = canjePrevio(db, tarjeta.id, {
      createdAt: new Date(Date.now() - 60 * 60_000),
    });
    const admin = { ...CAJERO, role: 'SUPER_ADMIN', tenantId: null } as AuthUser;

    await expect(svc.anular(admin, canje.id)).resolves.toEqual({ ok: true });
    expect(db.tabla('convenioCupon')[0].canjesCount).toBe(0);
  });

  it('nadie anula un canje de otro negocio', async () => {
    const { svc, db, tarjeta } = montar();
    const canje = canjePrevio(db, tarjeta.id);
    const ajeno = { ...CAJERO, tenantId: 'tenant-otro' } as AuthUser;

    await expect(svc.anular(ajeno, canje.id)).rejects.toThrow(ForbiddenException);
    expect(db.tabla('convenioCupon')[0].canjesCount).toBe(1);
  });
});

/**
 * El filtro por sedes: el dueño elige en qué sucursales aplica el convenio.
 *
 * Estaba escrito y MUERTO. La condición exigía un `locationId` que nadie
 * mandaba nunca —el escáner no tiene selector de sede— así que un beneficio
 * pactado solo para una sucursal se canjeaba en cualquiera: el panel ofrecía
 * elegir sedes y el producto no cumplía. Ahora cae a la sede del cajero.
 */
describe('el convenio que solo aplica en ciertas sedes', () => {
  /** Un cajero DE VERDAD: el `id` tiene que existir en la base para que el
   *  servicio pueda leer su sede. `CAJERO` es el dueño, que no tiene. */
  const enSede = (id: string | null) =>
    ({
      id: 'cajero-1',
      email: 'caja@cafeluna.co',
      role: 'TENANT_STAFF',
      tenantId: 'tenant-cafe',
      _sede: id,
    }) as unknown as AuthUser;

  it('rechaza el canje en una sede donde el convenio no aplica', async () => {
    const { svc, tarjeta } = montar({
      sedes: ['sede-centro'],
      sedeDelCajero: 'sede-norte',
    });
    await expect(
      svc.canjear(enSede('sede-norte'), {
        tarjetaId: tarjeta.id,
        cuponId: 'cupon-10',
        locationId: null,
        compraMonto: null,
      }),
    ).rejects.toThrow(/no aplica en esta sede/);
  });

  it('lo deja pasar en una sede donde sí aplica', async () => {
    const { svc, tarjeta } = montar({
      sedes: ['sede-centro'],
      sedeDelCajero: 'sede-centro',
    });
    const r = await svc.canjear(enSede('sede-centro'), {
      tarjetaId: tarjeta.id,
      cuponId: 'cupon-10',
      locationId: null,
      compraMonto: null,
    });
    expect(r.aplicar).toBeTruthy();
  });

  it('sin sedes configuradas aplica en todas, aunque el cajero tenga una', async () => {
    const { svc, tarjeta } = montar({ sedeDelCajero: 'sede-norte' });
    const r = await svc.canjear(enSede('sede-norte'), {
      tarjetaId: tarjeta.id,
      cuponId: 'cupon-10',
      locationId: null,
      compraMonto: null,
    });
    expect(r.aplicar).toBeTruthy();
  });

  it('un cajero SIN sede asignada no se queda fuera', async () => {
    // No se inventa una restricción que nadie configuró: sería peor que no
    // tenerla. Es también el caso del dueño, que nunca tiene sede.
    const { svc, tarjeta } = montar({
      sedes: ['sede-centro'],
      sedeDelCajero: null,
    });
    const r = await svc.canjear(enSede(null), {
      tarjetaId: tarjeta.id,
      cuponId: 'cupon-10',
      locationId: null,
      compraMonto: null,
    });
    expect(r.aplicar).toBeTruthy();
  });

  it('la sede que se registra en el canje es la EFECTIVA, no la que llegó vacía', async () => {
    // Si sale de la ficha del cajero, el informe por sede tiene que verla:
    // antes se guardaba el null que mandaba el escáner.
    const { svc, db, tarjeta } = montar({ sedeDelCajero: 'sede-centro' });
    await svc.canjear(enSede('sede-centro'), {
      tarjetaId: tarjeta.id,
      cuponId: 'cupon-10',
      locationId: null,
      compraMonto: null,
    });
    expect(db.datos.convenioCanje[0].locationId).toBe('sede-centro');
  });

  it('la pantalla del cajero avisa antes de que pulse, no al pulsar', async () => {
    const { svc, pass } = montar({
      sedes: ['sede-centro'],
      sedeDelCajero: 'sede-norte',
    });
    const r = await svc.resolverParaCaja(enSede('sede-norte'), pass.id, null);
    expect(r.cupones[0].disponible).toBe(false);
    expect(r.cupones[0].motivo).toMatch(/no aplica en esta sede/);
  });
});

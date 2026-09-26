import { describe, it, expect } from 'vitest';
import { WalletService } from './wallet.service';
import { ScannerService } from '../scanner/scanner.service';

/**
 * EL RECORRIDO COMPLETO de un cliente con una Tarjeta Informativa, de punta a
 * punta, con los datos REALES del primer negocio que la va a usar.
 *
 * Los datos salen de producción (consulta de solo lectura, 2026-09-25):
 * Degodoy, `degodoy-sas`, restaurante de Bucaramanga, marca Clubify, una sede
 * con geocerco de 300 m y sin texto de cercanía propio.
 *
 * Qué se comprueba, y por qué aquí y no a ojo: el `.pkpass` es lo único que el
 * cliente ve de verdad, y no se puede mirar desde el panel —la vista previa es
 * otra pantalla, y ya nos ha mentido—. Sin certificados de Apple,
 * `generateApplePass` devuelve el `pass.json` tal cual, así que estas pruebas
 * leen EXACTAMENTE lo que se le va a instalar en el teléfono.
 */

const NEGOCIO = {
  id: 'e6f2c9bb-degodoy',
  name: 'DEGODOY S.A.S.',
  brandName: 'Degodoy',
  slug: 'degodoy-sas',
  status: 'ACTIVE',
  locale: 'es',
  timezone: 'America/Bogota',
  country: 'CO',
  logoUrl: null,
  walletLogoUrl: null,
  pushLogoUrl: null,
  whiteLabelId: null,
  // La sede real, con su geocerco de 300 m.
  locations: [
    {
      id: 'loc-1',
      name: 'Cra. 36 #52-68',
      latitude: 7.1128901,
      longitude: -73.1081497,
      radiusMeters: 300,
      walletRelevantText: null,
      isActive: true,
    },
  ],
};

/** La credencial que el negocio configura: fondo negro y su distinción. */
const CREDENCIAL = {
  id: 'card-info',
  tenantId: NEGOCIO.id,
  type: 'INFO',
  name: 'Credencial Degodoy',
  walletBrandName: null,
  primaryColor: '#000000',
  secondaryColor: '#111111',
  rewardText: 'Cliente distinguido',
  terms: '',
  // Lo que delata que no es un cartón: no hay tope de sellos.
  stampsRequired: null,
  visitsRequired: null,
  convenioId: null,
  clubPlanId: null,
  logoUrl: null,
  logoBgColor: null,
  logoShape: null,
  heroImageUrl: null,
  stampIcon: null,
  stampIconImageUrl: null,
  stampActiveColor: null,
  stampInactiveColor: null,
  stampContourColor: null,
  centerBgColor: null,
  stampBgType: null,
  stampBgImageUrl: null,
  discountPercent: null,
  freeRewards: [],
  isActive: true,
};

const CLIENTE = {
  id: 'cli-1',
  fullName: 'María Fernanda Rojas',
  phone: '+573001112233',
  email: null,
  locale: null,
};

const PASE = {
  id: 'pase-1',
  tenantId: NEGOCIO.id,
  cardId: CREDENCIAL.id,
  customerId: CLIENTE.id,
  serialNumber: 'CLB-a1b2c3d4e5',
  qrToken: 'QR-abcdefghijklmnopqrst',
  authToken: 'auth-token-de-apple',
  status: 'ACTIVE',
  stampsCount: 0,
  visitsCount: 0,
  pointsBalance: 0,
  cashbackBalance: 0,
  currentTier: null,
  lastActivityAt: null,
  googleObjectId: null,
  card: CREDENCIAL,
  customer: CLIENTE,
  tenant: NEGOCIO,
};

/** El pase que se le instala en el iPhone, leído tal cual. */
async function pasoDeApple(cambios: Record<string, unknown> = {}) {
  const pase = { ...PASE, ...cambios };
  const prisma: any = {
    pass: { findUnique: async () => pase },
    notification: { findFirst: async () => null },
    whiteLabel: { findUnique: async () => null },
    tenant: { findUnique: async () => NEGOCIO },
  };
  const brand: any = {
    resolveTenant: async () => ({
      name: 'Clubify',
      slug: 'clubify',
      websiteUrl: 'https://soyclubify.com',
    }),
  };
  const svc = new WalletService(prisma, {} as any, brand);
  // Sin certificados de Apple devuelve el `pass.json` en claro. Es el camino
  // de dev y es exactamente lo que se firmaría en producción.
  const buffer = await svc.generateApplePass(pase.id);
  return JSON.parse(buffer.toString('utf8'));
}

describe('el pase que se instala el cliente de Degodoy', () => {
  it('el fondo es NEGRO y el texto BLANCO, sin cablear nada', async () => {
    const p = await pasoDeApple();
    // Sale del `primaryColor` que el negocio eligió; el blanco lo fija Apple.
    expect(p.backgroundColor).toBe('rgb(0,0,0)');
    expect(p.foregroundColor).toBe('rgb(255,255,255)');
  });

  it('NO PROMETE «0/10»: no hay contador en ninguna parte del pase', async () => {
    const p = await pasoDeApple();
    const todo = JSON.stringify(p);
    expect(todo).not.toMatch(/0\s*\/\s*10/);
    expect(todo).not.toMatch(/SELLOS/i);
    // Las filas de arriba están vacías, como en cualquier pase de la casa.
    expect(p.storeCard.headerFields).toEqual([]);
    expect(p.storeCard.primaryFields).toEqual([]);
  });

  it('los campos auxiliares llevan SOLO el nombre del cliente', async () => {
    const p = await pasoDeApple();
    // Uno y solo uno: sin la condición de INFO, aquí entraba el contador.
    expect(p.storeCard.auxiliaryFields).toEqual([
      { key: 'member', label: 'CLIENTE', value: 'María Fernanda Rojas' },
    ]);
  });

  it('lo que se lee es la DISTINCIÓN que escribió el negocio', async () => {
    const p = await pasoDeApple();
    expect(p.storeCard.secondaryFields).toEqual([
      { key: 'reward', label: 'ESTADO', value: 'Cliente distinguido' },
    ]);
  });

  it('sin distinción escrita dice ACTIVA, no un guion ni «RECOMPENSA»', async () => {
    const p = await pasoDeApple({
      card: { ...CREDENCIAL, rewardText: null },
    });
    expect(p.storeCard.secondaryFields[0]).toEqual({
      key: 'reward',
      label: 'ESTADO',
      value: 'ACTIVA',
    });
  });

  it('REVOCADA gana sobre el texto del negocio', async () => {
    const p = await pasoDeApple({ status: 'REVOKED' });
    expect(p.storeCard.secondaryFields[0].value).toBe('DESACTIVADA');
  });

  it('lleva el nombre del negocio, NO el de la plataforma', async () => {
    const p = await pasoDeApple();
    expect(p.logoText).toBe('Degodoy');
    expect(p.organizationName).toBe('Degodoy');
    expect(p.description).toBe('Credencial Degodoy');
  });

  it('el reverso trae el número de tarjeta y el «Creado por»', async () => {
    const p = await pasoDeApple();
    const atras = Object.fromEntries(
      p.storeCard.backFields.map((f: any) => [f.key, f]),
    );
    expect(atras.serial.value).toBe('CLB-a1b2c3d4e5');
    expect(atras.serial.label).toBe('Número de tarjeta');
    expect(atras.powered.label).toBe('Creado por Clubify');
    // Las condiciones vacías salen como guion, igual que en el resto: es un
    // campo que Apple exige y el negocio no rellenó.
    expect(atras.terms.value).toBe('—');
  });

  it('EL GEOCERCO DE SU SEDE viaja dentro del pase', async () => {
    const p = await pasoDeApple();
    expect(p.maxDistance).toBe(300);
    expect(p.locations).toHaveLength(1);
    expect(p.locations[0]).toMatchObject({
      latitude: 7.1128901,
      longitude: -73.1081497,
    });
    // Su sede NO tiene texto de cercanía configurado, y el respaldo nombra al
    // NEGOCIO, no a la plataforma. Que es lo que hay que comprobar: un
    // «Estás cerca de Clubify» en la pantalla de bloqueo del cliente de un
    // restaurante sería la fuga de marca de siempre.
    expect(p.locations[0].relevantText).toBe('Estás cerca de Degodoy');
    expect(p.locations[0].relevantText).not.toMatch(/Clubify/);
  });

  it('el código que lee el cajero es el token, no el serial', async () => {
    const p = await pasoDeApple();
    expect(p.barcodes[0].message).toBe('QR-abcdefghijklmnopqrst');
    expect(p.barcodes[0].altText).toBe('Creado por Clubify');
  });

  it('en INGLÉS sale en inglés: la credencial también se traduce', async () => {
    const p = await pasoDeApple({
      customer: { ...CLIENTE, locale: 'en-US' },
      card: { ...CREDENCIAL, rewardText: null },
    });
    expect(p.storeCard.secondaryFields[0]).toEqual({
      key: 'reward',
      label: 'STATUS',
      value: 'ACTIVE',
    });
    expect(p.storeCard.auxiliaryFields[0].label).toBe('MEMBER');
  });

  it('LA PRUEBA SABE PONERSE EN ROJO: la misma tarjeta como SELLOS sí dice 0/10', async () => {
    const p = await pasoDeApple({
      card: { ...CREDENCIAL, type: 'STAMPS' },
    });
    expect(JSON.stringify(p)).toMatch(/0\/10/);
  });
});

describe('cuando el cajero de Degodoy la escanea', () => {
  const escaner = (pase: Record<string, unknown>) => {
    const prisma: any = {
      pass: { findUnique: async () => pase, findFirst: async () => pase },
      stamp: { findMany: async () => [] },
    };
    return new ScannerService(
      {} as any, prisma, {} as any, {} as any, {} as any, {} as any,
    );
  };
  const cajero: any = {
    id: 'u-cajero',
    role: 'TENANT_STAFF',
    tenantId: NEGOCIO.id,
  };

  it('va a su pantalla, no a la de sellos', async () => {
    const r: any = await escaner({
      ...PASE,
      tenant: { ...NEGOCIO, whiteLabel: null },
    }).verifyQr(cajero, PASE.qrToken);
    expect(r.kind).toBe('info');
    // Y con el nombre, que es lo único que el cajero necesita.
    expect(r.pass.customer.fullName).toBe('María Fernanda Rojas');
  });
});

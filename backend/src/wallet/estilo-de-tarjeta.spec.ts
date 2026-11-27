import { beforeAll, describe, expect, it } from 'vitest';
import { estiloQueSeDibuja, leerEstiloDeTarjeta, validarEstiloDeTarjeta } from './estilo-de-tarjeta';
import { configDesdeTarjeta, dibujarFranja, ESTILOS_DE_TARJETA } from './estilos-de-franja';

const BUCKET = 'https://cdn.clubify.test';

beforeAll(() => {
  process.env.S3_PUBLIC_URL = BUCKET;
});

const tarjeta = {
  primaryColor: '#3B2418',
  secondaryColor: '#E9C9A0',
  stampIcon: '🍕',
  requeridos: 8,
  sellados: 3,
  premio: 'Cono gratis',
};

describe('validarEstiloDeTarjeta', () => {
  it('null es el clásico', () => {
    expect(validarEstiloDeTarjeta(null)).toBeNull();
    expect(validarEstiloDeTarjeta(undefined)).toBeNull();
  });

  it('guarda solo la forma y descarta lo que no es del estilo', () => {
    expect(validarEstiloDeTarjeta({ estilo: 'TAZA', recipiente: 'CONO', fondo: '#000', otro: 1 })).toEqual({
      estilo: 'TAZA',
      recipiente: 'CONO',
    });
  });

  it('no deja guardar el SELLOS del laboratorio ni estilos inventados', () => {
    for (const e of ['SELLOS', 'INVENTADO']) {
      expect(() => validarEstiloDeTarjeta({ estilo: e })).toThrow(/estilo/);
    }
    expect(validarEstiloDeTarjeta({ estilo: 'SALDO' })).toEqual({ estilo: 'SALDO' });
    expect(validarEstiloDeTarjeta({ estilo: 'VIP' })).toEqual({ estilo: 'VIP' });
  });

  it('las imágenes solo pueden ser de nuestro almacenamiento', () => {
    for (const url of ['https://otro.test/a.png', 'data:image/png;base64,AAAA', 'file:///etc/passwd']) {
      expect(() => validarEstiloDeTarjeta({ estilo: 'FOTO_NUMERO', portada: url })).toThrow(/portada/);
      expect(() =>
        validarEstiloDeTarjeta({ estilo: 'PRODUCTO', posiciones: [{ x: 1, y: 1, tam: 40, imagen: url }] }),
      ).toThrow(/posiciones/);
    }
    expect(validarEstiloDeTarjeta({ estilo: 'FOTO_NUMERO', portada: `${BUCKET}/a.jpg` })?.portada).toBe(
      `${BUCKET}/a.jpg`,
    );
  });

  it('números de posiciones: solo números, acotados', () => {
    expect(() =>
      validarEstiloDeTarjeta({ estilo: 'PRODUCTO', posiciones: [{ x: '1" onload="x', y: 1, tam: 40 }] }),
    ).toThrow(/posiciones/);
    const r = validarEstiloDeTarjeta({ estilo: 'PRODUCTO', posiciones: [{ x: 9999, y: 1, tam: 1 }] });
    expect(r?.posiciones?.[0]).toMatchObject({ x: 840, tam: 8, giro: 0 });
  });

  it('al dibujar, lo guardado que ya no vale cae al clásico en vez de romper el pase', () => {
    expect(leerEstiloDeTarjeta({ estilo: 'SELLOS' })).toBeNull();
    expect(leerEstiloDeTarjeta({ estilo: 'ANILLO' })).toEqual({ estilo: 'ANILLO' });
  });
});

describe('configDesdeTarjeta', () => {
  it('los colores salen de la tarjeta y el texto se lee sobre el fondo', () => {
    const oscuro = configDesdeTarjeta({ estilo: 'ANILLO' }, tarjeta);
    expect(oscuro).toMatchObject({ fondo: '#3B2418', area: '#3B2418', sello: '#E9C9A0', texto: '#FFFFFF' });
    const claro = configDesdeTarjeta({ estilo: 'ANILLO' }, { ...tarjeta, centerBgColor: '#FFF8EE' });
    expect(claro.texto).toBe('#1F1F1F');
  });

  it('un sello del mismo color que el fondo se cambia para que se vea el avance', () => {
    const c = configDesdeTarjeta({ estilo: 'TAZA' }, { ...tarjeta, stampActiveColor: '#3B2418' });
    expect(c.sello).toBe('#FFFFFF');
  });

  it('acota tope y sellos', () => {
    const c = configDesdeTarjeta({ estilo: 'TAZA' }, { ...tarjeta, requeridos: 99, sellados: 120 });
    expect(c.requeridos).toBe(30);
    expect(c.sellados).toBe(30);
  });

  it('todos los estilos de tarjeta dibujan sin NaN, vacíos y completos', () => {
    for (const estilo of ESTILOS_DE_TARJETA) {
      for (const sellados of [0, 8]) {
        const svg = dibujarFranja(configDesdeTarjeta({ estilo }, { ...tarjeta, sellados }));
        expect(svg, estilo).not.toMatch(/NaN|undefined/);
      }
    }
  });
});

describe('recipientes de la taza', () => {
  it('todos dibujan sin NaN, vacíos, a medias y completos', () => {
    const recipientes = ['TAZA', 'VASO', 'CONO', 'POCILLO', 'PARA_LLEVAR', 'FRAPPE', 'JARRA', 'COPA'] as const;
    const svgs = new Set<string>();
    for (const recipiente of recipientes) {
      for (const sellados of [0, 3, 8]) {
        const svg = dibujarFranja(configDesdeTarjeta({ estilo: 'TAZA', recipiente }, { ...tarjeta, sellados }));
        expect(svg, `${recipiente} ${sellados}`).not.toMatch(/NaN|undefined/);
        if (sellados === 3) svgs.add(svg);
      }
    }
    // Cada recipiente dibuja algo distinto: ninguno cae callado en la taza.
    expect(svgs.size).toBe(recipientes.length);
  });
});

describe('estiloQueSeDibuja', () => {
  it('cada estilo solo en su tipo de tarjeta', () => {
    expect(estiloQueSeDibuja({ type: 'STAMPS', stripStyle: { estilo: 'TAZA' } })).toEqual({ estilo: 'TAZA' });
    expect(estiloQueSeDibuja({ type: 'CASHBACK', stripStyle: { estilo: 'SALDO' } })).toEqual({ estilo: 'SALDO' });
    expect(estiloQueSeDibuja({ type: 'MEMBERSHIP', stripStyle: { estilo: 'VIP' } })).toEqual({ estilo: 'VIP' });
    // Un estilo que quedó de otro tipo (la tarjeta cambió de tipo) no se dibuja.
    expect(estiloQueSeDibuja({ type: 'CASHBACK', stripStyle: { estilo: 'TAZA' } })).toBeNull();
    expect(estiloQueSeDibuja({ type: 'STAMPS', stripStyle: { estilo: 'SALDO' } })).toBeNull();
    expect(estiloQueSeDibuja({ type: 'COUPON', stripStyle: { estilo: 'TAZA' } })).toBeNull();
  });

  it('VIP solo con niveles por gasto: dibuja montos', () => {
    expect(estiloQueSeDibuja({ type: 'MEMBERSHIP', stripStyle: { estilo: 'VIP' }, tierMetric: 'spend' })).not.toBeNull();
    expect(estiloQueSeDibuja({ type: 'MEMBERSHIP', stripStyle: { estilo: 'VIP' }, tierMetric: 'visits' })).toBeNull();
  });

  it('alianzas y clubes conservan su franja', () => {
    expect(estiloQueSeDibuja({ type: 'STAMPS', stripStyle: { estilo: 'TAZA' }, convenioId: 'c' })).toBeNull();
    expect(estiloQueSeDibuja({ type: 'STAMPS', stripStyle: { estilo: 'TAZA' }, clubPlanId: 'p' })).toBeNull();
  });

  it('Saldo y VIP con pesos legibles y sin NaN', () => {
    const niveles = [
      { nombre: 'Bronce', desde: 0, beneficio: '' },
      { nombre: 'Plata', desde: 300000, beneficio: 'Postre' },
    ];
    const saldo = dibujarFranja(configDesdeTarjeta({ estilo: 'SALDO' }, { ...tarjeta, saldo: 12500, porcentaje: 5 }));
    expect(saldo).toContain('$12.500');
    expect(saldo).not.toContain('12.500,00');
    const vip = dibujarFranja(configDesdeTarjeta({ estilo: 'VIP' }, { ...tarjeta, gastado: 180000, niveles }));
    expect(vip).toContain('$120.000');
    expect(vip).not.toMatch(/NaN|undefined/);
  });
});

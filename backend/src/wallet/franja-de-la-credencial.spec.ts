import { describe, it, expect, vi, afterEach } from 'vitest';
import sharp from 'sharp';
import { WalletService } from './wallet.service';

/**
 * QUE EL LOGO ESTÉ DE VERDAD EN EL CENTRO.
 *
 * Esto no se puede comprobar leyendo el `pass.json`: en Apple Wallet un logo
 * centrado no es un campo, es una IMAGEN. `logo.png` va anclado arriba a la
 * izquierda y limitado a 160×50 puntos, así que lo único que ocupa el ancho
 * completo del pase es la franja, y el «centrado» es dónde caen los píxeles
 * dentro de ella.
 *
 * Por eso estas pruebas DECODIFICAN el PNG que se genera y miran dónde está el
 * logo. Comprobar que la función «devuelve tres buffers» habría pasado en verde
 * con el logo pegado a una esquina.
 *
 * `generateApplePass` no sirve de puerta de entrada: sin certificados de Apple
 * devuelve el `pass.json` y sale ANTES de dibujar ninguna imagen. Se llama al
 * generador directamente, como hace `logo-de-alianza.spec.ts`.
 */

const NEGRO_DE_DEGODOY = '#000000';

/**
 * Un logo como los de verdad: una marca de color sobre un lienzo TRANSPARENTE.
 *
 * El borde transparente no es adorno. `prepareLogoForWallet` borra el blanco
 * pegado al borde de la imagen, y respeta el diseño entero solo cuando la
 * fuente ya trae transparencia propia. Un cuadrado de color a sangre no es un
 * logo real, y con uno blanco la prueba mediría el borrado, no el centrado.
 */
async function logoDePrueba(color: string, lienzo = 200): Promise<Buffer> {
  const marca = Math.round(lienzo * 0.8);
  const borde = Math.round((lienzo - marca) / 2);
  return sharp({
    create: {
      width: lienzo,
      height: lienzo,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: { width: marca, height: marca, channels: 4, background: color },
        })
          .png()
          .toBuffer(),
        left: borde,
        top: borde,
      },
    ])
    .png()
    .toBuffer();
}

function servicio() {
  const svc = Object.create(WalletService.prototype) as any;
  // El logger solo se usa en el camino de error.
  svc.logger = { warn: () => {}, log: () => {} };
  return svc;
}

async function franja(opts: {
  logo: Buffer;
  primary?: string;
  logoBgColor?: string | null;
  logoShape?: string | null;
}) {
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    arrayBuffer: async () => opts.logo,
  }));
  return (await servicio().generateCredentialStrip({
    primary: opts.primary ?? NEGRO_DE_DEGODOY,
    logoUrl: 'https://cdn/degodoy.png',
    logoBgColor: opts.logoBgColor ?? null,
    logoShape: opts.logoShape ?? null,
  })) as Record<string, Buffer>;
}

/** Dónde cae lo que NO es del color del fondo. */
async function cajaDeLoPintado(png: Buffer, fondo: { r: number; g: number; b: number }) {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      const esFondo =
        Math.abs(data[i] - fondo.r) < 12 &&
        Math.abs(data[i + 1] - fondo.g) < 12 &&
        Math.abs(data[i + 2] - fondo.b) < 12;
      if (esFondo) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('la franja de una credencial', () => {
  it('EL LOGO QUEDA CENTRADO, no en una esquina', async () => {
    const imgs = await franja({ logo: await logoDePrueba('#E11D48') });
    const caja = await cajaDeLoPintado(imgs['strip.png'], { r: 0, g: 0, b: 0 });
    expect(caja).not.toBeNull();
    // El centro de lo pintado es el centro de la franja. Es LA comprobación:
    // con el logo pegado a la izquierda —que es donde Apple lo pone por su
    // cuenta— esto daría 71 y 123, y el pedido era justamente sacarlo de ahí.
    expect(caja!.cx).toBeCloseTo(640 / 2, -0.5);
    expect(caja!.cy).toBeCloseTo(246 / 2, -0.5);
  });

  it('el logo respira: no toca ningún borde de la franja', async () => {
    // Un logo a sangre se lee como un recorte mal hecho.
    const imgs = await franja({ logo: await logoDePrueba('#E11D48') });
    const caja = (await cajaDeLoPintado(imgs['strip.png'], { r: 0, g: 0, b: 0 }))!;
    expect(caja.x0).toBeGreaterThan(10);
    expect(caja.y0).toBeGreaterThan(10);
    expect(caja.x1).toBeLessThan(640 - 10);
    expect(caja.y1).toBeLessThan(246 - 10);
  });

  it('EL FONDO ES EL COLOR DE LA TARJETA, sin costura', async () => {
    // Si la franja no fuera exactamente del color del pase, se vería una banda
    // cruzando la credencial justo donde acaba la imagen. Es lo que hacía la
    // franja verde de Clubify que ya se quitó una vez.
    const imgs = await franja({
      logo: await logoDePrueba('#FFFFFF'),
      primary: '#1B2A4A',
    });
    const { data } = await sharp(imgs['strip.png'])
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // La esquina, lejos del logo.
    expect([data[0], data[1], data[2]]).toEqual([0x1b, 0x2a, 0x4a]);
  });

  it('las tres resoluciones que Apple pide, y con las medidas del storeCard', async () => {
    const imgs = await franja({ logo: await logoDePrueba('#E11D48') });
    expect(Object.keys(imgs).sort()).toEqual([
      'strip.png',
      'strip@2x.png',
      'strip@3x.png',
    ]);
    const m1 = await sharp(imgs['strip.png']).metadata();
    const m3 = await sharp(imgs['strip@3x.png']).metadata();
    expect([m1.width, m1.height]).toEqual([640, 246]);
    expect([m3.width, m3.height]).toEqual([1920, 738]);
  });

  it('UN LOGO NEGRO SOBRE FONDO NEGRO NO DESAPARECE', async () => {
    // El caso que obliga a medir. Sin la plancha, Degodoy repartiría
    // credenciales con el centro vacío y nadie lo vería: en la vista previa del
    // panel se pinta sobre el mismo color.
    const imgs = await franja({ logo: await logoDePrueba('#0A0A0A') });
    const caja = await cajaDeLoPintado(imgs['strip.png'], { r: 0, g: 0, b: 0 });
    expect(caja).not.toBeNull();
    // Y lo que se ve es la plancha clara, centrada.
    const { data, info } = await sharp(imgs['strip.png'])
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const i = (Math.round(info.height / 2) * info.width + 20) * 4;
    expect([data[i], data[i + 1], data[i + 2]]).toEqual([0, 0, 0]); // borde: fondo
    expect(caja!.cx).toBeCloseTo(320, -0.5);
  });

  it('un logo CLARO sobre fondo oscuro va limpio, sin plancha detrás', async () => {
    // El caso bueno: el negocio eligió el fondo oscuro porque su marca es
    // clara. Una plancha ahí le rompería el diseño.
    const imgs = await franja({ logo: await logoDePrueba('#FFFFFF') });
    const caja = (await cajaDeLoPintado(imgs['strip.png'], { r: 0, g: 0, b: 0 }))!;
    const { data, info } = await sharp(imgs['strip.png'])
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // Lo pintado mide lo que el logo, sin el reborde que añadiría la plancha.
    expect(caja.x1 - caja.x0).toBeLessThanOrEqual(144);
    const centro = (Math.round(info.height / 2) * info.width + 320) * 4;
    expect([data[centro], data[centro + 1], data[centro + 2]]).toEqual([255, 255, 255]);
  });

  it('el fondo que el negocio ELIGIÓ para su logo se respeta', async () => {
    const imgs = await franja({
      logo: await logoDePrueba('#FFFFFF'),
      logoBgColor: '#FF6B35',
    });
    const caja = (await cajaDeLoPintado(imgs['strip.png'], { r: 0, g: 0, b: 0 }))!;
    // Con plancha, lo pintado es MÁS ANCHO que el logo solo.
    expect(caja.x1 - caja.x0).toBeGreaterThan(144);
    expect(caja.cx).toBeCloseTo(320, -0.5);
  });

  it('un color de tarjeta que no se entiende NO dibuja una franja de otro color', async () => {
    // Apple caería a su respaldo y una banda de color distinto cruzando el
    // pase es peor que no tener franja.
    const imgs = await franja({
      logo: await logoDePrueba('#FFFFFF'),
      primary: 'Restaurante La Estación',
    });
    expect(imgs).toEqual({});
  });

  it('si el logo no se puede descargar, no hay franja (y el pase queda liso)', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, arrayBuffer: async () => Buffer.alloc(0) }));
    const imgs = await servicio().generateCredentialStrip({
      primary: NEGRO_DE_DEGODOY,
      logoUrl: 'https://cdn/caido.png',
    });
    expect(imgs).toEqual({});
  });

  it('UN LOGO QUE SE BORRA AL PREPARARLO TAMPOCO DEJA UNA FRANJA VACÍA', async () => {
    // Un PNG blanco SÓLIDO, sin transparencia propia: `prepareLogoForWallet` le
    // quita el blanco pegado al borde y no queda nada. La cabecera del pase se
    // protege probando el siguiente candidato de la lista; aquí no hay lista, y
    // una banda del color del fondo con nada dentro se lee como una imagen que
    // no cargó.
    const blancoASangre = await sharp({
      create: { width: 200, height: 200, channels: 4, background: '#FFFFFF' },
    })
      .png()
      .toBuffer();
    expect(await franja({ logo: blancoASangre })).toEqual({});
  });

  it('LA PRUEBA SABE PONERSE EN ROJO: detecta un logo descentrado', async () => {
    // El detector se comprueba contra una imagen hecha a mano con el logo
    // pegado a la izquierda —que es exactamente el defecto que se arregló—.
    // Sin esto, `cajaDeLoPintado` podría estar devolviendo el centro siempre.
    const pegadoALaIzquierda = await sharp({
      create: { width: 640, height: 246, channels: 4, background: '#000000' },
    })
      .composite([{ input: await logoDePrueba('#E11D48', 100), left: 8, top: 8 }])
      .png()
      .toBuffer();
    const caja = (await cajaDeLoPintado(pegadoALaIzquierda, { r: 0, g: 0, b: 0 }))!;
    expect(caja.cx).toBeLessThan(100);
    expect(caja.cx).not.toBeCloseTo(320, -0.5);
  });
});

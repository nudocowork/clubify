import { describe, it, expect } from 'vitest';
import { revisarComprobante, tipoPorExtension } from './comprobante-de-pago';

/**
 * El comprobante de la transferencia de comisiones.
 *
 * Existe para responder una sola pregunta meses después: ¿esta plata salió de
 * verdad? Por eso lo que se guarda tiene que seguir abriéndose dentro de un
 * año: un enlace roto, apuntando afuera del bucket o con un esquema que el
 * navegador no abre, es lo mismo que no tener comprobante.
 */

const BUCKET = 'https://pub-abc123.r2.dev';

describe('un pago puede no tener comprobante', () => {
  it('sin archivo la revisión pasa y no hay comprobante', () => {
    expect(revisarComprobante(undefined, undefined, BUCKET)).toEqual({
      ok: true,
      comprobante: null,
    });
    expect(revisarComprobante('', 'application/pdf', BUCKET)).toEqual({
      ok: true,
      comprobante: null,
    });
    expect(revisarComprobante('   ', null, BUCKET)).toEqual({
      ok: true,
      comprobante: null,
    });
  });
});

describe('lo que sí se acepta', () => {
  it('el PDF del banco', () => {
    const r = revisarComprobante(
      `${BUCKET}/payout-proofs/aBc123.pdf`,
      'application/pdf',
      BUCKET,
    );
    expect(r).toEqual({
      ok: true,
      comprobante: {
        url: `${BUCKET}/payout-proofs/aBc123.pdf`,
        mimeType: 'application/pdf',
      },
    });
  });

  it('la captura de la transferencia (JPG, PNG y el WebP que devuelve el optimizador)', () => {
    for (const [ext, mime] of [
      ['jpg', 'image/jpeg'],
      ['png', 'image/png'],
      ['webp', 'image/webp'],
    ] as const) {
      const r = revisarComprobante(`${BUCKET}/payout-proofs/x.${ext}`, mime, BUCKET);
      expect(r.ok).toBe(true);
      expect(r.ok && r.comprobante?.mimeType).toBe(mime);
    }
  });

  it('sin tipo declarado lo deduce de la extensión — el icono del panel no se pierde', () => {
    const r = revisarComprobante(`${BUCKET}/payout-proofs/x.pdf`, null, BUCKET);
    expect(r.ok && r.comprobante?.mimeType).toBe('application/pdf');
  });

  it('el host en MAYÚSCULAS es el mismo host', () => {
    // El dominio no distingue mayúsculas y el parser de URL ya lo normaliza.
    // Si alguien cambiara la comparación por strings crudos, esto se cae.
    const r = revisarComprobante(
      'https://PUB-ABC123.R2.DEV/payout-proofs/x.pdf',
      'application/pdf',
      BUCKET,
    );
    expect(r.ok).toBe(true);
  });

  it('un `charset` pegado al tipo no lo invalida', () => {
    const r = revisarComprobante(
      `${BUCKET}/payout-proofs/x.png`,
      'image/png; charset=binary',
      BUCKET,
    );
    expect(r.ok).toBe(true);
  });
});

describe('lo que se rechaza, y por qué', () => {
  it('http a secas: el panel lo pinta como enlace y no es un comprobante seguro', () => {
    const r = revisarComprobante('http://pub-abc123.r2.dev/x.pdf', 'application/pdf', BUCKET);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.motivo).toMatch(/https/i);
  });

  it('`data:` y `javascript:` no son archivos del banco', () => {
    expect(revisarComprobante('data:application/pdf;base64,AAAA', null, BUCKET).ok).toBe(false);
    expect(revisarComprobante('javascript:alert(1)', null, BUCKET).ok).toBe(false);
  });

  it('cualquier cosa que no sea una URL', () => {
    expect(revisarComprobante('comprobante.pdf', null, BUCKET).ok).toBe(false);
  });

  it('un host que solo EMPIEZA como el del bucket — el agujero del proxy de /media', () => {
    // `startsWith(base)` aceptaba `https://<base>.attacker.com/...`. Aquí se
    // compara el host exacto: el comprobante tiene que estar en NUESTRO bucket
    // o el día que haya que demostrar el pago no lo sirve nadie.
    const r = revisarComprobante(
      'https://pub-abc123.r2.dev.attacker.com/x.pdf',
      'application/pdf',
      BUCKET,
    );
    expect(r.ok).toBe(false);
  });

  it('un enlace con usuario/contraseña, aunque el host sea el bueno', () => {
    // `https://pub-abc123.r2.dev@attacker.com/x.pdf` se lee de reojo como si
    // fuera nuestro bucket. Y con credenciales de verdad tampoco es un archivo
    // público del bucket, así que no hay caso legítimo.
    const r = revisarComprobante(
      'https://usuario:clave@pub-abc123.r2.dev/payout-proofs/x.pdf',
      'application/pdf',
      BUCKET,
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.motivo).toMatch(/usuario/i);
  });

  it('un .mp4 sin tipo declarado — el panel no siempre manda el contentType', () => {
    // El uploader por persona no capturaba `contentType`, así que el tipo
    // llegaba en null y no había nada que comparar. El tipo se deduce de la
    // extensión y, si de ahí tampoco sale, no se guarda.
    const r = revisarComprobante(`${BUCKET}/payout-proofs/x.mp4`, null, BUCKET);
    expect(r.ok).toBe(false);
  });

  it('sin extensión y sin tipo no se guarda: no hay con qué decidir', () => {
    const r = revisarComprobante(`${BUCKET}/payout-proofs/sinextension`, null, BUCKET);
    expect(r.ok).toBe(false);
  });

  it('otro puerto es otro origen', () => {
    const r = revisarComprobante(
      'https://pub-abc123.r2.dev:8443/payout-proofs/x.pdf',
      'application/pdf',
      BUCKET,
    );
    expect(r.ok).toBe(false);
  });

  it('un archivo que no es imagen ni PDF', () => {
    const r = revisarComprobante(`${BUCKET}/payout-proofs/x.mp4`, 'video/mp4', BUCKET);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.motivo).toMatch(/PDF/);
  });
});

describe('sin bucket configurado (dev) se exige https igual', () => {
  it('acepta cualquier host https', () => {
    expect(revisarComprobante('https://localhost:9000/clubify-media/x.pdf', null, null).ok).toBe(
      true,
    );
  });

  it('pero sigue rechazando http', () => {
    expect(revisarComprobante('http://localhost:9000/x.pdf', null, undefined).ok).toBe(false);
  });
});

describe('deducir el tipo por la extensión', () => {
  it('reconoce las cuatro que acepta el bucket', () => {
    expect(tipoPorExtension('https://x/y.jpeg')).toBe('image/jpeg');
    expect(tipoPorExtension('https://x/y.JPG')).toBe('image/jpeg');
    expect(tipoPorExtension('https://x/y.png')).toBe('image/png');
    expect(tipoPorExtension('https://x/y.webp')).toBe('image/webp');
    expect(tipoPorExtension('https://x/y.pdf')).toBe('application/pdf');
  });

  it('ignora la query: el nombre del archivo está antes del `?`', () => {
    expect(tipoPorExtension('https://x/y.pdf?v=2')).toBe('application/pdf');
  });

  it('sin extensión conocida no inventa un tipo', () => {
    expect(tipoPorExtension('https://x/y')).toBeNull();
    expect(tipoPorExtension('https://x/y.docx')).toBeNull();
  });
});

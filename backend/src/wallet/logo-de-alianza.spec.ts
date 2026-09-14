import { describe, it, expect } from 'vitest';
import { GoogleWalletService } from './google-wallet.service';

/**
 * Qué logo va ARRIBA en una tarjeta de alianza.
 *
 * EL FALLO (2026-09-14, Altieri Specialty Coffee): «en las tarjetas de alianza
 * no aparece el logo de ellos en la parte de arriba, solo el de la empresa con
 * la que tienen alianza, en el centro».
 *
 * `Card.logoUrl` de una tarjeta de alianza guarda el logo del ALIADO —es el que
 * pinta la franja del centro del pase—, y la cabecera lo tomaba a él por ser el
 * primer candidato de la lista. Resultado: el aliado salía dos veces y el
 * negocio que emite la tarjeta, ninguna.
 *
 * Arriba va la casa; el aliado, el centro. Vale para cualquier negocio con
 * alianzas, no solo Altieri.
 */

const MARCA = { logoUrl: 'https://cdn/marca.png', iconUrl: 'https://cdn/marca-icono.png' };

function servicio() {
  return Object.create(GoogleWalletService.prototype) as any;
}

/** Un pase, con o sin alianza. El `?v=` de cache-bust se quita para comparar. */
function logoDe(pass: any): string {
  return servicio().resolveLogoUri(pass, MARCA).split('?')[0];
}

const NEGOCIO = {
  walletLogoUrl: 'https://cdn/altieri-wallet.png',
  logoUrl: 'https://cdn/altieri.png',
};

describe('el logo de la cabecera del pase', () => {
  it('en una ALIANZA es el del negocio, no el del aliado', () => {
    const logo = logoDe({
      card: { convenioId: 'c1', logoUrl: 'https://cdn/morgan.png' },
      tenant: NEGOCIO,
    });
    expect(logo).toBe('https://cdn/altieri-wallet.png');
    expect(logo).not.toContain('morgan');
  });

  it('en una tarjeta normal sigue mandando el logo de la tarjeta', () => {
    // El caso Valmont: cambiar el logo de la tarjeta tiene que verse en el pase.
    expect(
      logoDe({
        card: { convenioId: null, logoUrl: 'https://cdn/tarjeta.png' },
        tenant: NEGOCIO,
      }),
    ).toBe('https://cdn/tarjeta.png');
  });

  it('una alianza de un negocio SIN logo hereda el de su marca, nunca el del aliado', () => {
    const logo = logoDe({
      card: { convenioId: 'c1', logoUrl: 'https://cdn/morgan.png' },
      tenant: { walletLogoUrl: null, logoUrl: null },
    });
    expect(logo).toBe('https://cdn/marca.png');
  });

  it('el cache-bust sigue saliendo cuando el pase tiene actividad', () => {
    const uri = servicio().resolveLogoUri(
      {
        card: { convenioId: 'c1', logoUrl: 'https://cdn/morgan.png' },
        tenant: NEGOCIO,
        lastActivityAt: new Date('2026-09-14T12:00:00Z'),
      },
      MARCA,
    );
    // Sin él, Google se queda con la imagen vieja cacheada y el arreglo no se
    // ve en los pases ya instalados.
    expect(uri).toContain('altieri-wallet.png?v=');
  });
});

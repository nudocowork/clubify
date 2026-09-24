import { describe, it, expect } from 'vitest';
import { SoloPlataformaGuard } from './solo-plataforma.guard';
import { MaintenanceAdminController } from '../../maintenance/maintenance.controller';
import { SettingsController } from '../../settings/settings.controller';
import { SmsTemplatesController } from '../../billing/sms-templates.controller';
import { QuotesController } from '../../quotes/quotes.controller';

/**
 * Este archivo existe porque el candado se puede borrar sin que nada se entere.
 *
 * `SoloPlataformaGuard` protege rutas que escriben cosas GLOBALES de la
 * plataforma. Si alguien quita un `@UseGuards` al refactorizar, el backend
 * compila, los tests de negocio siguen verdes y el agujero vuelve sin ruido:
 * el admin de una marca blanca es un SUPER_ADMIN con `whiteLabelId`, así que
 * `@Roles` lo deja pasar (ver `solo-plataforma.guard.ts`).
 *
 * La prueba mira los metadatos que Nest deja en el método, que es exactamente
 * lo que se pierde al quitar el decorador. Borra un `@UseGuards` y esto se
 * pone rojo.
 */

/** Los guards que Nest guardó para ese método, o para la clase entera. */
function guardsDe(objetivo: unknown): unknown[] {
  return (Reflect.getMetadata('__guards__', objetivo as object) ?? []) as unknown[];
}

function protegeLaPlataforma(clase: new (...args: never[]) => object, metodo?: string): boolean {
  const enLaClase = guardsDe(clase);
  const enElMetodo = metodo
    ? guardsDe((clase.prototype as Record<string, unknown>)[metodo])
    : [];
  return [...enLaClase, ...enElMetodo].includes(SoloPlataformaGuard);
}

describe('las rutas de la plataforma llevan su candado', () => {
  it('apagar el modo mantenimiento de TODA la plataforma', () => {
    // El agujero más grave que encontró la auditoría: el admin de Sellea
    // dejaba a Clubify y al resto de marcas en 503.
    expect(protegeLaPlataforma(MaintenanceAdminController, 'update')).toBe(true);
  });

  it('el GET de mantenimiento NO se cierra: hay uno público con lo mismo', () => {
    // Cerrarlo no protegería nada y revivía el 403 del panel de Fidelia.
    expect(protegeLaPlataforma(MaintenanceAdminController, 'status')).toBe(false);
  });

  const ajustesGlobales = [
    'getBrandingAdmin',
    'setBranding',
    'getPricing',
    'setPricing',
    'getEnlacesExtra',
    'setEnlacesExtra',
    'setLandingPlans',
    'getHotmartCoupon',
    'setHotmartCoupon',
    'getTrialPolicy',
    'setTrialPolicy',
  ];

  it.each(ajustesGlobales)('ajustes de plataforma: %s', (metodo) => {
    expect(protegeLaPlataforma(SettingsController, metodo)).toBe(true);
  });

  it('las plantillas SMS globales', () => {
    // Editarlas cambia el mensaje que reciben los clientes de todas las marcas
    // que no tengan texto propio.
    expect(protegeLaPlataforma(SmsTemplatesController)).toBe(true);
  });

  it('las cotizaciones', () => {
    // `Quote` no tiene marca ni negocio: sin candado se listan y se borran
    // todas, con nombre, teléfono, correo y precio de cada cliente.
    expect(protegeLaPlataforma(QuotesController)).toBe(true);
  });
});

describe('la prueba sabe ponerse en rojo', () => {
  it('una clase sin el guard da false', () => {
    class SinCandado {
      cualquiera() {
        return null;
      }
    }
    expect(protegeLaPlataforma(SinCandado, 'cualquiera')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';

/**
 * Hasta dónde llega un cambio hecho en el MENÚ PRINCIPAL.
 *
 * LO QUE PASABA (Javier, 2026-09-18): «cuando se hace un cambio en el menú
 * principal, que aparezca una notificación que indique si se quiere el cambio
 * para solo ese menú o para todos los submenús también». Hasta hoy propagaba
 * SIEMPRE y en silencio: quien corregía una errata de un producto del principal
 * le cambiaba el producto a las 10 cartas de sus oficinas sin enterarse. En
 * producción hay negocios con 11 cartas y 77 productos cada una.
 *
 * Lo que decide es una condición en `ProductsService.update`. Se reproduce aquí
 * porque el servicio arrastra NestJS y no se puede instanciar sin base de datos
 * —el mismo motivo que ya explica `menus.spec.ts`—. Lo que se prueba es la
 * REGLA, y la regla es la línea de la condición.
 *
 * ⚠ Si cambias la condición en `products.service.ts`, cambia también esto: son
 *   dos copias, y el spec no importa el servicio.
 */

/** La condición real: `if (dto.alcance !== 'solo-esta') propagar()`. */
function propaga(alcance?: 'solo-esta' | 'todas'): boolean {
  return alcance !== 'solo-esta';
}

describe('el alcance de un cambio en el menú principal', () => {
  it('«solo esta carta» NO toca las demás', () => {
    expect(propaga('solo-esta')).toBe(false);
  });

  it('«todas» sí las toca', () => {
    expect(propaga('todas')).toBe(true);
  });

  it('sin alcance se comporta como antes: propaga', () => {
    // Un cliente viejo, una importación o el editor rápido de precios no
    // mandan el campo. No pueden cambiar de comportamiento por no conocerlo:
    // dejar de propagar en silencio sería peor que propagar de más, porque el
    // negocio creería que cambió el precio en todas y no lo hizo.
    expect(propaga(undefined)).toBe(true);
  });

  it('un valor raro no apaga la propagación por accidente', () => {
    // El PATCH es `Partial<ProductBody>` y Nest NO lo valida, así que puede
    // llegar cualquier cosa. Solo el literal exacto la apaga.
    for (const raro of ['SOLO-ESTA', 'solo esta', 'ninguna', '', 'true'] as any[]) {
      expect(propaga(raro)).toBe(true);
    }
  });
});

/**
 * Cuándo se le pregunta al negocio. Vive en el panel (`app/menu/page.tsx`),
 * pero la regla es de producto y conviene tenerla escrita.
 */
function sePregunta(opts: {
  esProductoNuevo: boolean;
  enMenuPrincipal: boolean;
  cartasEnganchadas: number;
}): boolean {
  return (
    !opts.esProductoNuevo && opts.enMenuPrincipal && opts.cartasEnganchadas > 0
  );
}

describe('cuándo sale el aviso', () => {
  it('editando en el menú principal y con cartas que lo siguen', () => {
    expect(sePregunta({ esProductoNuevo: false, enMenuPrincipal: true, cartasEnganchadas: 10 })).toBe(true);
  });

  it('no molesta a un negocio de una sola carta', () => {
    // Es la inmensa mayoría: preguntarles algo que no les aplica sería ruido
    // en cada guardado.
    expect(sePregunta({ esProductoNuevo: false, enMenuPrincipal: true, cartasEnganchadas: 0 })).toBe(false);
  });

  it('no sale editando en una carta que no es la principal', () => {
    // Ahí el cambio ya se queda donde toca; es lo que Javier describió como
    // correcto.
    expect(sePregunta({ esProductoNuevo: false, enMenuPrincipal: false, cartasEnganchadas: 3 })).toBe(false);
  });

  it('no sale al CREAR un producto: todavía no lo sigue nadie', () => {
    expect(sePregunta({ esProductoNuevo: true, enMenuPrincipal: true, cartasEnganchadas: 0 })).toBe(false);
  });
});

/**
 * Cuántos sellos (o visitas) lleva un cartón. Una sola respuesta, para todos.
 *
 * EL FALLO, encontrado el 2026-09-26 mirando producción: `stampsRequired` es
 * nullable, y cuando falta **cada lector se inventa una respuesta distinta**:
 *
 *   · el pase de Apple y el de Google         → `?? 10`
 *   · el tope al sellar (`stamps.service`)    → `?? Number.MAX_SAFE_INTEGER`
 *   · el canje del premio                     → `?? 10`
 *   · `reglaDeEstado` (¿está completa?)       → null: NUNCA se completa
 *
 * El resultado en producción: «Descomunal - Cocina y SportBar» reparte una
 * tarjeta por «Desgranado de Pollo + Gaseosa» desde el 23 de julio, con **59
 * pases, 54 instalados en teléfonos y 64 sellos puestos**. Sus clientes ven
 * «8/10» en el móvil —un 10 que el negocio no eligió— y, como el pase no puede
 * llegar nunca a COMPLETED, **nadie puede reclamar el pollo**. Dos personas van
 * por 8.
 *
 * El 10 no se quita: es lo que esos 54 clientes llevan meses viendo, y
 * cambiarlo ahora rompería la promesa que ya se les hizo. Lo que se arregla es
 * que sea UNA sola respuesta y que quede ESCRITA en la tarjeta, para que el
 * cartón se pueda completar y el premio se pueda entregar.
 *
 * Y sobre todo: que no vuelva a nacer ninguna así.
 */

/**
 * El valor que se escribe cuando nadie mandó tope.
 *
 * Es 10 porque 10 es lo que el pase YA enseña. Escribirlo no cambia ni un píxel
 * de lo que el cliente ve; lo que cambia es que a partir de ahí el cartón se
 * puede dar por lleno.
 */
export const TOPE_POR_DEFECTO = 10;

export type TipoDeTarjeta = string;

/**
 * Normaliza el tope de una tarjeta que se va a CREAR.
 *
 * Se usa en las puertas que no piden el dato al usuario —la Sync API del
 * Onboarding, el duplicador de negocios— donde rechazar la creación rompería
 * un alta que por lo demás está bien. Devuelve también si hubo que rellenarlo,
 * para poder dejarlo en el log y que no pase inadvertido.
 */
export function conTopeNormalizado(
  tipo: TipoDeTarjeta,
  datos: Record<string, unknown>,
): {
  datos: Record<string, unknown>;
  rellenado: 'stampsRequired' | 'visitsRequired' | null;
} {
  if (tipo === 'STAMPS' && datos.stampsRequired == null) {
    return {
      datos: { ...datos, stampsRequired: TOPE_POR_DEFECTO },
      rellenado: 'stampsRequired',
    };
  }
  if (tipo === 'VISITS' && datos.visitsRequired == null) {
    return {
      datos: { ...datos, visitsRequired: TOPE_POR_DEFECTO },
      rellenado: 'visitsRequired',
    };
  }
  return { datos, rellenado: null };
}

/**
 * Por qué NO se puede guardar esta tarjeta, en español y dirigido al negocio.
 * `null` = se puede.
 *
 * Esto es para el PANEL, donde sí hay alguien mirando que puede poner el
 * número. Aquí no se rellena a la callada: un cartón sin tope es una tarjeta
 * que su dueño cree que funciona y que ningún cliente puede completar, y el
 * momento de decírselo es cuando la está creando.
 *
 * `tope` llega `undefined` cuando el formulario no manda el campo (una edición
 * parcial que no lo toca): eso NO es quitarlo, así que no se rechaza.
 */
export function motivoParaRechazarElTope(
  tipo: TipoDeTarjeta | undefined,
  tope: number | null | undefined,
): string | null {
  if (tope === undefined) return null;
  if (tipo === 'STAMPS' && tope == null) {
    return 'Falta cuántos sellos lleva la tarjeta. Sin ese número tus clientes ven un cartón que nunca pueden completar.';
  }
  if (tipo === 'VISITS' && tope == null) {
    return 'Falta cuántas visitas lleva la tarjeta. Sin ese número tus clientes ven un cartón que nunca pueden completar.';
  }
  return null;
}

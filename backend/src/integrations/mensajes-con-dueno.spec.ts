import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Todo mensaje que sale POR UN NEGOCIO tiene que decir de qué negocio es.
 *
 * `registrarEnvio` (grow-business.service) deduce la MARCA a partir del
 * negocio, pero solo si el llamador le pasa el `tenantId`. Sin contexto, la
 * fila nace sin negocio y sin marca — y una fila sin marca **se lee como de
 * Clubify**, por la regla «null = legacy» de la lectura.
 *
 * Medido en producción el 2026-09-27: 700 de 1.346 filas de 30 días sin marca.
 * De ellas, **3 pertenecían a un negocio de Sellea**, así que sus mensajes se
 * estaban pintando en el panel de Clubify. Es la fuga de marca de siempre, esta
 * vez por omisión.
 *
 * Y hay un segundo daño, el que se vio esta misma mañana: sin `tenantId`,
 * buscar por el nombre del negocio en «Mensajes enviados» no encuentra sus
 * mensajes, y la pantalla contesta que no salió nada cuando sí salió.
 *
 * ESTA PRUEBA ES UN CANDADO, no un inventario. La lista de excepciones de abajo
 * es lo que hay que mirar: cada una tiene que tener un motivo escrito.
 */

/**
 * Llamadas que NO pasan negocio con razón: avisos internos al equipo de
 * Clubify, que no pertenecen a ningún negocio.
 *
 * `auth/auth.service.ts` NO está aquí por su motivo, sino porque es trabajo sin
 * commitear de la otra máquina y no se toca. Hay que revisarlo cuando aterrice.
 */
const SIN_NEGOCIO_A_PROPOSITO: Record<string, string> = {
  'auth/prereg-alerts.service.ts': 'avisos al equipo: preregistros y compras sin cuenta',
  'auth/auth.service.ts': 'trabajo sin commitear de la otra máquina — revisar al aterrizar',
  'superadmin/superadmin.service.ts': 'envíos del panel maestro, sin negocio',
  'white-label-notifications/white-label-notifications.service.ts': 'avisos a la MARCA, no a un negocio',
  'crm/crm.service.ts': 'CRM del afiliado: no tiene negocio (no lleva tenantId)',
  'billing/hotmart.service.ts': 'pagos recibidos SIN cuenta todavía: aún no hay negocio',
  'delivery/delivery.service.ts': 'portal de la empresa de domicilios, fuera del negocio',
};

/** Recorta la llamada equilibrando paréntesis, para leer sus argumentos. */
function llamadaCompleta(src: string, desde: number): string {
  let i = src.indexOf('(', desde);
  let prof = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') prof++;
    else if (src[i] === ')' && --prof === 0) break;
  }
  return src.slice(desde, i + 1);
}

function ficheros(dir: string, salida: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) ficheros(p, salida);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) salida.push(p);
  }
  return salida;
}

describe('un mensaje de un negocio dice de qué negocio es', () => {
  const raiz = path.join(process.cwd(), 'src');

  const sinContexto = ficheros(raiz)
    .flatMap((f) => {
      const src = fs.readFileSync(f, 'utf8');
      const rel = path.relative(raiz, f).split(path.sep).join('/');
      const fuera: string[] = [];
      let i = src.indexOf('sendSmsWithCreds(');
      while (i !== -1) {
        const esDefinicion = src.slice(Math.max(0, i - 30), i).includes('async ');
        const llamada = llamadaCompleta(src, i);
        if (
          !esDefinicion &&
          !llamada.includes('tenantId') &&
          !llamada.includes('whiteLabelId') &&
          !llamada.includes('ctx')
        ) {
          fuera.push(rel);
        }
        i = src.indexOf('sendSmsWithCreds(', i + 1);
      }
      return fuera;
    });

  it('ninguna llamada NUEVA se manda sin decir de quién es', () => {
    const inesperadas = [...new Set(sinContexto)].filter(
      (f) => !(f in SIN_NEGOCIO_A_PROPOSITO),
    );
    expect(
      inesperadas,
      `Estas llamadas envían un SMS sin \`tenantId\` ni \`whiteLabelId\`. ` +
        `Sin eso la fila nace sin marca y se lee como de Clubify. ` +
        `Si de verdad no pertenece a ningún negocio, añádela a ` +
        `SIN_NEGOCIO_A_PROPOSITO con el motivo.`,
    ).toEqual([]);
  });

  it('la lista de excepciones no se queda vieja', () => {
    // Una excepción que ya no hace falta es peor que ninguna: la próxima
    // persona la lee y cree que ese fichero sigue mandando a ciegas.
    const siguenSinContexto = new Set(sinContexto);
    const sobran = Object.keys(SIN_NEGOCIO_A_PROPOSITO).filter(
      (f) => !siguenSinContexto.has(f),
    );
    expect(sobran, 'sobran en SIN_NEGOCIO_A_PROPOSITO').toEqual([]);
  });

  it('cada excepción tiene un motivo escrito, no una cadena vacía', () => {
    for (const [f, motivo] of Object.entries(SIN_NEGOCIO_A_PROPOSITO)) {
      expect(motivo.trim().length, f).toBeGreaterThan(10);
    }
  });

  it('LA PRUEBA SABE PONERSE EN ROJO: detecta una llamada sin contexto', () => {
    // Se comprueba el detector contra un texto de mentira, para que no pase en
    // verde por no estar encontrando nada.
    const falso = 'await this.gb.sendSmsWithCreds(creds, phone, body);';
    const llamada = llamadaCompleta(falso, falso.indexOf('sendSmsWithCreds('));
    expect(llamada).toBe('sendSmsWithCreds(creds, phone, body)');
    expect(llamada.includes('tenantId')).toBe(false);

    const bueno = 'await this.gb.sendSmsWithCreds(creds, phone, body, { tenantId });';
    const l2 = llamadaCompleta(bueno, bueno.indexOf('sendSmsWithCreds('));
    expect(l2.includes('tenantId')).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  mismoNumeroDeCliente,
  soloElMismoTelefono,
  variantesDelNumero,
} from './passes.service';

/**
 * EL 500 QUE VEÍA UN CLIENTE AL DARSE DE ALTA.
 *
 * Reportado el 2026-09-28: Eudes Rincón rellena el formulario de una tarjeta
 * —enlace compartido por Valmont— y recibe «Internal server error» en rojo,
 * debajo de sus datos. No es un fallo de red ni de la pasarela: es un camino
 * del código que acaba en `throw`.
 *
 * LOS CUATRO PASOS, con sus datos reales:
 *
 *  1. Ya existe en ese negocio, con `eudesrincon3@gmail.com` y el teléfono
 *     `+584247224687`.
 *  2. Vuelve a registrarse y teclea el móvil COMO SE ESCRIBE EN VENEZUELA:
 *     `04247224687`. Con el indicativo del formulario queda
 *     `+5804247224687` — y ese cero se queda EN MEDIO.
 *  3. `mismoNumeroDeCliente` compara por el final, así que no lo reconoce: el
 *     guardado no es sufijo del tecleado. Al no reconocerlo, intenta CREAR una
 *     ficha nueva, que choca con `@@unique([tenantId, email])`.
 *  4. El `catch` del P2002 solo volvía a buscar POR TELÉFONO. No lo encuentra
 *     —el conflicto era del correo— y relanza. 500 en la cara del cliente.
 *
 * Se arregla por los dos lados: reconocerlo en el paso 3, y que el paso 4 sepa
 * que hay DOS índices únicos.
 */

const EUDES_GUARDADO = '+584247224687';
const EUDES_TECLEADO = '+5804247224687';

describe('el cero de troncal no convierte a un cliente en otro', () => {
  it('EL CASO REAL: +5804247224687 es el mismo que +584247224687', () => {
    expect(mismoNumeroDeCliente(EUDES_TECLEADO, EUDES_GUARDADO)).toBe(true);
    // Y al revés, que el orden no puede importar.
    expect(mismoNumeroDeCliente(EUDES_GUARDADO, EUDES_TECLEADO)).toBe(true);
  });

  it('vale para indicativos de una, dos y tres cifras', () => {
    // Estados Unidos (1), Venezuela (58), Ecuador (593) — los tres largos que
    // existen, porque aquí no se sabe dónde acaba el indicativo.
    expect(mismoNumeroDeCliente('+10555123456', '+1555123456')).toBe(true);
    expect(mismoNumeroDeCliente('+5804123456789', '+584123456789')).toBe(true);
    expect(mismoNumeroDeCliente('+5930987654321', '+593987654321')).toBe(true);
  });

  it('LO QUE YA FUNCIONABA SIGUE IGUAL', () => {
    // Mismo número escrito con y sin indicativo, que es el caso de siempre.
    expect(mismoNumeroDeCliente('+573001112233', '3001112233')).toBe(true);
    expect(mismoNumeroDeCliente('+57 300 111 22 33', '+573001112233')).toBe(true);
    expect(mismoNumeroDeCliente('3001112233', '3001112233')).toBe(true);
  });

  it('NO EMPAREJA A DOS PERSONAS DISTINTAS', () => {
    // Es lo que hay que cuidar al hacer la comparación más permisiva: dos
    // clientes fundidos en uno es peor que un cliente duplicado.
    expect(mismoNumeroDeCliente('+584247224687', '+584247224688')).toBe(false);
    expect(mismoNumeroDeCliente('+573001112233', '+573001112234')).toBe(false);
    // Con menos de 8 cifras no se arriesga nada.
    expect(mismoNumeroDeCliente('224687', '+584247224687')).toBe(false);
    expect(mismoNumeroDeCliente('', '+584247224687')).toBe(false);
    expect(mismoNumeroDeCliente(null, null)).toBe(false);
  });

  it('las variantes son CANDIDATAS, no verdades', () => {
    // Se prueban los tres cortes posibles sin saber cuál es el indicativo, así
    // que un número con un 0 en esa zona genera una variante que quizá no
    // significa nada — `573000112233` (Colombia) produce `57300112233`.
    //
    // Y no pasa nada, porque la variante no empareja por sí sola: tiene que
    // coincidir por el final con OTRO número y con 8 cifras o más. Lo que
    // protege de fundir a dos clientes es ese umbral, no esta lista.
    expect(variantesDelNumero('5804247224687')).toContain('584247224687');
    expect(variantesDelNumero('573000112233')).toContain('573000112233');
    // Y NUNCA por sufijo: la variante solo casa si es EXACTAMENTE el otro
    // número. Que dos números distintos compartan cola no las junta.
    // Sin ningún 0 en esa zona, no hay variante que inventar. (Ojo al elegir
    // el ejemplo: casi todos los móviles colombianos son `+57 3xx…` y el
    // cuarto dígito suele ser 0, así que sí generan candidata.)
    expect(variantesDelNumero('573151112233')).toEqual(['573151112233']);
    // Y un número corto no se descompone: no hay nada que quitar.
    expect(variantesDelNumero('50')).toEqual(['50']);
  });

  it('una variante NO hace pasar por iguales a dos números distintos', () => {
    // La comprobación que de verdad importa del cambio de arriba.
    expect(mismoNumeroDeCliente('+573000112233', '+5700112233')).toBe(false);
    expect(mismoNumeroDeCliente('+573000112233', '+573001112233')).toBe(false);
  });

  it('LOS DOS PARES QUE ROMPIÓ FABLE, fijados para siempre', () => {
    // 1. Miami +1 305… contra un fijo de Santos (Brasil): la variante del
    //    +1 sin su 0 resultaba ser exactamente la COLA del brasileño, y por
    //    sufijo casaban. «Mi tarjeta» le enseñaba a uno los pases del otro.
    //    Por eso las variantes solo valen por IGUALDAD, nunca por sufijo.
    expect(mismoNumeroDeCliente('+13055550123', '+551355550123')).toBe(false);
    // 2. Dos móviles colombianos REALES tecleados en local (310… y 301…):
    //    ambos colapsaban a la misma variante. Por eso un número sin
    //    indicativo (menos de 11 cifras) no genera variantes: su 0 es suyo.
    expect(mismoNumeroDeCliente('3101234567', '3011234567')).toBe(false);
    expect(variantesDelNumero('3101234567')).toEqual(['3101234567']);
  });

  it('el filtro del mostrador hereda el arreglo', () => {
    // `soloElMismoTelefono` es lo que usa la caja para buscar a un cliente por
    // su número. Si reconoce en un sitio y no en otro, el cajero ve una cosa y
    // el alta hace otra.
    const fichas = [
      { phone: EUDES_GUARDADO, id: 'el-bueno' },
      { phone: '+584247224688', id: 'otro' },
    ];
    expect(soloElMismoTelefono(EUDES_TECLEADO, fichas).map((f) => f.id)).toEqual([
      'el-bueno',
    ]);
  });
});

describe('y si aun así choca, el alta NO revienta', () => {
  /**
   * La segunda mitad. Aunque el reconocimiento falle por otro motivo, crear la
   * ficha puede chocar con CUALQUIERA de los dos índices únicos. Esta prueba
   * mira el código porque el camino necesita base de datos: lo que importa es
   * que el `catch` no se quede mirando solo uno, que es lo que pasaba.
   */
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/passes/passes.service.ts'),
    'utf8',
  );
  const trozo = src.slice(
    src.indexOf('async enrollPublic'),
    src.indexOf('async enrollPublic') + 9000,
  );

  it('el catch del P2002 conoce los DOS índices, y el del correo contesta con un mensaje', () => {
    const i = trozo.indexOf("code === 'P2002'");
    expect(i, 'ya no hay manejo de P2002 en enrollPublic').toBeGreaterThan(-1);
    const manejo = trozo.slice(i, i + 2600);
    expect(manejo).toContain('tenantId_phone');
    expect(
      manejo.includes('tenantId_email'),
      'el catch solo mira el índice del teléfono. Si el choque viene del ' +
        'correo —el cliente ya estaba con otro formato de número— relanza y el ' +
        'cliente ve un 500 en el formulario.',
    ).toBe(true);
    // Y EL DEL CORREO NO ENTREGA LA TARJETA DE OTRO. La primera versión usaba
    // la ficha del dueño del correo, y con correos compartidos en casa eso le
    // daba a quien teclea el correo de otro un QR canjeable ajeno (lo señaló
    // la revisión de Fable). El contrato es un 400 que se puede obedecer.
    expect(
      manejo.includes('ya está registrado en este negocio con otro'),
      'el choque por correo tiene que contestar con el mensaje accionable, ' +
        'no asignar la ficha del dueño del correo.',
    ).toBe(true);
  });

  it('LOS DOS ÍNDICES SIGUEN EXISTIENDO, que es lo que obliga a mirar los dos', () => {
    const schema = fs.readFileSync(
      path.join(process.cwd(), 'prisma', 'schema.prisma'),
      'utf8',
    );
    expect(schema).toContain('@@unique([tenantId, email])');
    expect(schema).toContain('@@unique([tenantId, phone])');
  });

  it('LA PRUEBA SABE PONERSE EN ROJO: distingue el antes del después', () => {
    // El catch de antes, tal cual estaba, para comprobar que el detector lo
    // habría cazado en vez de pasar en verde.
    const comoEstaba = `if (e?.code === 'P2002') {
      customer = await this.prisma.customer.findUnique({
        where: { tenantId_phone: { tenantId: card.tenantId, phone: phoneNorm } },
      });
      if (!customer) throw e;`;
    expect(comoEstaba.includes('tenantId_phone')).toBe(true);
    expect(comoEstaba.includes('tenantId_email')).toBe(false);
  });
});

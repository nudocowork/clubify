import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * `EmailService.send` no manda nada en producción.
 *
 * Sin `RESEND_API_KEY` —y en Railway no existe, ni debe existir: el transporte
 * del producto es Grow Business— el servicio cae al `ConsoleEmailAdapter`, que
 * imprime una línea y devuelve un objeto de éxito. Además `send()` se traga
 * cualquier excepción. O sea: el llamador lee «ok» y no salió nada.
 *
 * Así se perdieron seis correos durante meses, y los dos peores no se notaron
 * porque el panel decía que sí: «pedido listo» al cliente final (174 pedidos
 * solo en septiembre) y las invitaciones de administrador, que llevan el token
 * de aceptación — dos personas llevaban tres meses esperando.
 *
 * Esta prueba barre el código y se pone ROJA en cuanto alguien lo vuelva a
 * llamar. Lo que hay que usar es `BrandEmailService`: `sendTemplate` para las
 * plantillas de marca, `sendRaw` para un correo suelto.
 */

const RAIZ = join(__dirname, '..');

/**
 * Lo que falta por migrar, a la vista y con fecha.
 *
 * `auth.service.ts` tiene la invitación al afiliado (`inviteAffiliateTemplate`)
 * todavía por `EmailService`. NO se tocó el 2026-09-24 porque el archivo tenía
 * 41 líneas sin commitear de la otra máquina, y en este repo —que se sincroniza
 * por OneDrive— editar encima del trabajo abierto de otro se lo lleva por
 * delante.
 *
 * Cuando esos cambios estén commiteados: migrarlo y borrar esta entrada. La
 * lista está aquí, y no escondida en el filtro, para que se vea al leer el test.
 */
const PENDIENTES_DE_MIGRAR = [join('auth', 'auth.service.ts')];

/** Todos los .ts de producción bajo src/, sin tests. */
function archivosDeProduccion(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) {
      salida.push(...archivosDeProduccion(ruta));
      continue;
    }
    if (!entrada.endsWith('.ts')) continue;
    if (entrada.endsWith('.spec.ts') || entrada.endsWith('.e2e-spec.ts')) continue;
    salida.push(ruta);
  }
  return salida;
}

describe('el correo sale por el transporte que está vivo', () => {
  const archivos = archivosDeProduccion(RAIZ);

  it('hay código que barrer (si no, la prueba no probaría nada)', () => {
    expect(archivos.length).toBeGreaterThan(200);
  });

  const llamaAlMuerto = (ruta: string) =>
    /this\.email\s*\n?\s*\.send\s*\(/.test(readFileSync(ruta, 'utf8'));

  const culpables = archivos
    .filter((ruta) => !ruta.includes(join('src', 'email'))) // el propio servicio sí puede
    .filter(llamaAlMuerto)
    .map((ruta) => ruta.slice(RAIZ.length + 1));

  it('nadie nuevo llama a EmailService.send', () => {
    expect(
      culpables.filter((r) => !PENDIENTES_DE_MIGRAR.includes(r)),
      'Usa BrandEmailService (sendTemplate o sendRaw). EmailService.send no manda nada en producción.',
    ).toEqual([]);
  });

  it('la lista de pendientes no se queda con entradas ya migradas', () => {
    // Si alguien migra `auth.service.ts` y olvida quitarlo de la lista, esto
    // avisa: una excepción que ya no hace falta es una mentira en el archivo.
    const yaMigrados = PENDIENTES_DE_MIGRAR.filter((r) => !culpables.includes(r));
    expect(yaMigrados, 'Ya está migrado: bórralo de PENDIENTES_DE_MIGRAR.').toEqual([]);
  });

  it('la prueba sabe ponerse en rojo', () => {
    // El mismo patrón, contra un texto que sí lo tiene.
    const patron = /this\.email\s*\.?\s*\n?\s*\.send\s*\(/;
    expect(patron.test('await this.email.send({ to });')).toBe(true);
    expect(patron.test('await this.brandEmail.sendRaw({ to });')).toBe(false);
  });
});

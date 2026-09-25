/**
 * Pruebas de la Tarjeta Informativa en el CLIENTE.
 *
 *   node scripts/pruebas-credencial.mjs
 *
 * Es el espejo de lo que calculan `wallet.service.ts` y
 * `google-wallet.service.ts`. Existe porque la misma frase se decide en tres
 * sitios: si se separan, el negocio configura mirando una cosa y el cliente
 * recibe otra en el móvil.
 */
import {
  ACTIVA,
  REVOCADA,
  llevaCarton,
  textoDeLaCredencial,
} from '../src/lib/credencial.mjs';

let fallos = 0;
let casos = 0;
function prueba(nombre, fn) {
  casos++;
  try {
    fn();
    console.log('ok    ', nombre);
  } catch (e) {
    fallos++;
    console.log('FALLO ', nombre, '\n       ', e.message);
  }
}
const igual = (a, b, d) => {
  const A = JSON.stringify(a);
  const B = JSON.stringify(b);
  if (A !== B) throw new Error(`${d} — esperado ${B}, obtenido ${A}`);
};

prueba('sin texto del negocio dice ACTIVA', () => {
  igual(textoDeLaCredencial(), ACTIVA, 'sin argumentos');
  igual(textoDeLaCredencial({}), ACTIVA, 'objeto vacío');
  igual(textoDeLaCredencial({ textoDelNegocio: null }), ACTIVA, 'nulo');
  igual(textoDeLaCredencial({ textoDelNegocio: '   ' }), ACTIVA, 'solo espacios');
});

prueba('CON texto del negocio manda el suyo — esto la hace genérica', () => {
  igual(
    textoDeLaCredencial({ textoDelNegocio: 'Cliente distinguido' }),
    'Cliente distinguido',
    'restaurante',
  );
  igual(
    textoDeLaCredencial({ textoDelNegocio: '  Socio fundador  ' }),
    'Socio fundador',
    'se recortan los espacios',
  );
});

prueba('REVOCADA GANA SIEMPRE, por bonito que sea el texto del negocio', () => {
  // Si esto se invirtiera, a quien le retiraron la credencial le seguiría
  // diciendo «Socio fundador» en el móvil y la enseñaría en la puerta.
  igual(
    textoDeLaCredencial({ revocada: true, textoDelNegocio: 'Socio fundador' }),
    REVOCADA,
    'con texto',
  );
  igual(textoDeLaCredencial({ revocada: true }), REVOCADA, 'sin texto');
});

prueba('el mismo resultado que el backend en los cuatro casos', () => {
  // Los cuatro que resuelven wallet.service.ts y google-wallet.service.ts.
  const casos = [
    [{}, 'ACTIVA'],
    [{ textoDelNegocio: 'VIP' }, 'VIP'],
    [{ revocada: true }, 'DESACTIVADA'],
    [{ revocada: true, textoDelNegocio: 'VIP' }, 'DESACTIVADA'],
  ];
  for (const [entrada, esperado] of casos) {
    igual(textoDeLaCredencial(entrada), esperado, JSON.stringify(entrada));
  }
});

prueba('EL CARTÓN: una credencial no dibuja huecos que llenar', () => {
  igual(llevaCarton({ tipo: 'INFO' }), false, 'informativa');
  igual(llevaCarton({ tipo: 'STAMPS' }), true, 'sellos');
  igual(llevaCarton({ tipo: 'STAMPS', alianza: { empresa: 'X' } }), false, 'alianza');
  igual(llevaCarton({ tipo: 'STAMPS', club: { cupo: 10 } }), true, 'club pequeño');
  igual(llevaCarton({ tipo: 'STAMPS', club: { cupo: 30 } }), false, 'club grande');
});

prueba('la comprobación sabe ponerse en ROJO', () => {
  // El criterio EQUIVOCADO: dejar que el texto del negocio gane a la
  // revocación. Si alguien lo escribe así, la prueba de arriba se pone roja.
  const malo = (e) => (e.textoDelNegocio || '').trim() || (e.revocada ? REVOCADA : ACTIVA);
  const revocadaConTexto = { revocada: true, textoDelNegocio: 'Socio fundador' };
  igual(malo(revocadaConTexto), 'Socio fundador', 'el criterio malo deja pasar el texto');
  if (malo(revocadaConTexto) === textoDeLaCredencial(revocadaConTexto)) {
    throw new Error('el criterio bueno y el malo coinciden: la prueba no prueba nada');
  }
});

console.log(`\n${casos - fallos}/${casos} en verde`);
process.exit(fallos ? 1 : 0);

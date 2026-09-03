#!/usr/bin/env node
/**
 * Despliegue con freno de mano.
 *
 * ── Por qué existe ─────────────────────────────────────────────────────────
 *
 * Este producto se trabaja desde dos máquinas y las dos despliegan al mismo
 * producción. En un solo día pasaron las dos formas de perder trabajo:
 *
 *   1. Una máquina desplegó el backend con `railway up`, que sube EL
 *      DIRECTORIO LOCAL y no lo que hay en git. Se llevó por delante 192
 *      commits de la otra que estaban en producción. Se vio porque rutas que
 *      daban 401 pasaron a dar 404.
 *
 *   2. El repo vive dentro de OneDrive, que sincroniza el directorio de
 *      trabajo entre las dos máquinas. El trabajo SIN COMMITEAR de una
 *      aparece en la copia de la otra; un `git add -A` se lo lleva dentro de
 *      un commit ajeno, con su mensaje equivocado y, si estaba a medias, sin
 *      compilar.
 *
 * Este script despliega SIEMPRE una copia limpia del commit, nunca la carpeta,
 * asi que el trabajo a medias de la otra maquina nunca llega a produccion.
 *
 * ── Uso ────────────────────────────────────────────────────────────────────
 *
 *   node scripts/desplegar.cjs backend
 *   node scripts/desplegar.cjs frontend
 *   node scripts/desplegar.cjs backend --force   (salta los frenos; que conste)
 */
const { execSync, spawnSync } = require('child_process');

const OBJETIVO = process.argv[2];
const FORZAR = process.argv.includes('--force');

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim();
}

function morir(titulo, detalle, comoSeArregla) {
  console.error(`\n  ✖ ${titulo}\n`);
  if (detalle) console.error(`${detalle}\n`);
  if (comoSeArregla) console.error(`  Cómo se arregla:\n${comoSeArregla}\n`);
  console.error('  (Si de verdad sabes lo que haces: --force)\n');
  process.exit(1);
}

if (!['backend', 'frontend'].includes(OBJETIVO)) {
  console.error('\n  Uso: node scripts/desplegar.cjs backend|frontend\n');
  process.exit(1);
}

console.log(`\n  Preparando despliegue de ${OBJETIVO.toUpperCase()}…\n`);

// ── 1. Traer lo que haya subido la otra máquina ────────────────────────────
try {
  execSync('git fetch --all --quiet', { stdio: 'ignore' });
} catch {
  console.warn('  ⚠ No se pudo hacer fetch. ¿Hay red? Sigo, pero a ciegas.');
}

const rama = git('rev-parse --abbrev-ref HEAD');

// ── 2. Avisar de lo que hay suelto, pero no bloquear ───────────────────────
//
// Con OneDrive sincronizando, el directorio casi NUNCA está limpio: el trabajo
// sin commitear de la otra máquina aparece aquí solo. Bloquear por eso haría
// el script inservible. Lo que se hace en su lugar es no subir el directorio
// (ver el paso 5): se despliega una copia limpia del commit.
const sucio = git('status --porcelain');
if (sucio) {
  const n = sucio.split('\n').length;
  console.log(
    `  ⚠ Hay ${n} archivo(s) sin commitear. NO van a subir — se despliega\n` +
      `    el commit, no la carpeta. Si algo de eso era tuyo, commitéalo antes.\n`,
  );
}

// ── 3. No desplegar por detrás de origin ───────────────────────────────────
//
// Desplegar estando detrás borra de producción lo que la otra máquina subió.
let detras = 0;
let adelante = 0;
try {
  const cuenta = git(`rev-list --left-right --count origin/${rama}...HEAD`);
  [detras, adelante] = cuenta.split(/\s+/).map(Number);
} catch {
  console.warn(`  ⚠ La rama ${rama} no está en origin. Empújala antes.`);
}

if (detras > 0 && !FORZAR) {
  const queFalta = git(`log --oneline HEAD..origin/${rama}`)
    .split('\n')
    .slice(0, 10)
    .map((l) => `    ${l}`)
    .join('\n');
  morir(
    `Te faltan ${detras} commit(s) que ya están en origin.`,
    `${queFalta}\n\n  Desplegar ahora los borraría de producción.`,
    `    git merge origin/${rama}   (y verifica que compila antes de seguir)`,
  );
}

if (adelante > 0 && !FORZAR) {
  morir(
    `Tienes ${adelante} commit(s) sin empujar.`,
    '  Si los despliegas sin subirlos, producción tendrá código que no está\n' +
      '  en ninguna rama. Es como acabamos con código en producción que nadie\n' +
      '  podía encontrar.',
    '    git push origin HEAD',
  );
}

// ── 3 bis. Contener TODO lo que ya está en producción ─────────────────────
//
// El chequeo de arriba compara contra `origin/<tu rama>`. Si despliegas desde
// otra rama pasa tranquilo, y aun así borra de producción lo que esa otra rama
// no tiene. Ha pasado cuatro veces esta semana: el commit estaba en git,
// sincronizado, y producción servía código sin él.
//
// La comprobación es de ASCENDENCIA, no de nombre: HEAD tiene que CONTENER la
// punta de cada rama viva, vengas de donde vengas. Es de Jhon, y es mejor que
// la que había aquí —«tienes que estar EN main»—, que se saltaba con un
// checkout y no decía nada de si tu copia tenía el trabajo del otro.
//
// Van las DOS ramas a propósito. Cada máquina creía que la de producción era
// la suya —una `main`, otra `feat/commissions-auto-cutoffs`— y ese desacuerdo
// ES el problema: con una sola en la lista, quien desplegara desde la otra
// seguiría pisando. Exigiendo las dos, no se puede desplegar nada que le falte
// trabajo a alguien. Cuando quede una sola rama viva, se quita la otra de aquí.
//
// OJO — esto NO cubre `vercel promote`. Promover no pasa por el script: coge un
// despliegue viejo que ya está en Vercel y lo pone en producción sin mirar git.
// La única defensa contra eso es no usarlo.
const RAMAS_VIVAS = (process.env.RAMAS_PROD || 'main,feat/commissions-auto-cutoffs')
  .split(',')
  .map((r) => r.trim())
  .filter(Boolean);

if (!FORZAR) {
  for (const viva of RAMAS_VIVAS) {
    let existe = true;
    try {
      execSync(`git rev-parse --verify --quiet origin/${viva}`, { stdio: 'ignore' });
    } catch {
      // Una rama ya borrada no debe bloquear el despliegue: sería un freno que
      // nadie puede levantar.
      existe = false;
    }
    if (!existe) {
      console.warn(`  ⚠ origin/${viva} ya no existe. Quítala de RAMAS_PROD.`);
      continue;
    }

    let contiene = false;
    try {
      execSync(`git merge-base --is-ancestor origin/${viva} HEAD`, { stdio: 'ignore' });
      contiene = true;
    } catch {
      contiene = false;
    }
    if (contiene) continue;

    let faltan = '';
    try {
      faltan = git(`log --oneline HEAD..origin/${viva}`)
        .split('\n')
        .slice(0, 12)
        .map((l) => `    ${l}`)
        .join('\n');
    } catch {
      faltan = '    (no se pudo listar)';
    }
    morir(
      `Lo que vas a desplegar NO contiene «${viva}».`,
      `  Le faltan estos commits, y desplegar así los borra de producción:\n\n${faltan}`,
      `    git fetch origin\n` +
        `    git merge origin/${viva}      (y comprueba que compila)\n\n` +
        `    No uses --force para saltártelo: es justo lo que borra el trabajo\n` +
        `    del otro sin que nadie se entere hasta que algo aparece roto.`,
    );
  }
}

// ── 4. Decir en voz alta qué se va a desplegar ─────────────────────────────
// Comillas obligatorias: sin ellas el shell parte «%h %s» en dos argumentos y
// git intenta interpretar «%s» como una revisión.
const ultimo = git('log -1 --pretty=format:"%h %s"');
console.log(`  rama:   ${rama}`);
console.log(`  commit: ${ultimo}`);
console.log(`  estado: limpio, sincronizado con origin\n`);

// ── 5. Clonar el commit a una carpeta limpia y desplegar DESDE AHÍ ─────────
//
// Esta es la pieza que resuelve el problema de raíz. Ni `railway up` ni
// `vercel deploy` suben lo que hay en git: suben LA CARPETA. Y esta carpeta
// vive en OneDrive, así que contiene el trabajo a medias de la otra máquina.
// Desplegar desde aquí ha mandado a producción código de otro sin terminar.
//
// Con un clon del commit se sube exactamente lo que está en git y nada más.
// De paso el paquete es más pequeño: sin node_modules, sin .next, sin basura.
const os = require('os');
const path = require('path');
const fs = require('fs');

const COPIA = path.join(os.tmpdir(), `clubify-deploy-${OBJETIVO}`);
fs.rmSync(COPIA, { recursive: true, force: true });

console.log('  Clonando el commit a una carpeta limpia…');
execSync(`git clone --quiet --no-hardlinks . "${COPIA}"`, { stdio: 'inherit' });
execSync(`git -C "${COPIA}" checkout --quiet ${git('rev-parse HEAD')}`);

const sueltos = execSync(`git -C "${COPIA}" status --porcelain`, {
  encoding: 'utf8',
}).trim();
if (sueltos) {
  morir('La copia limpia no salió limpia.', sueltos, '    Revisa a mano.');
}
console.log('  Copia verificada: solo lo que está en git.\n');

if (OBJETIVO === 'backend') {
  // Se sube desde la RAÍZ del repo, no desde backend/ — el railway.json de la
  // raíz es el que apunta al Dockerfile correcto.
  //
  // La copia hay que enlazarla al proyecto: Railway asocia proyecto ↔ carpeta.
  // Y `railway up <ruta>` con una ruta de fuera falla con "prefix not found",
  // así que se entra en la copia y se sube desde dentro.
  console.log('  Enlazando y subiendo a Railway…\n');
  const link = spawnSync(
    'railway',
    [
      'link',
      '--project', 'ba90d94d-7e6d-4056-85ad-0e3f24e8d43a',
      '--environment', 'production',
      '--service', 'backend',
    ],
    { stdio: 'inherit', shell: true, cwd: COPIA },
  );
  if (link.status) process.exit(link.status);

  const r = spawnSync('railway', ['up', '--service', 'backend', '--detach'], {
    stdio: 'inherit',
    shell: true,
    cwd: COPIA,
  });
  if (r.status) process.exit(r.status);

  // ── 6. Comprobar que el despliegue ENTRÓ ────────────────────────
  //
  // `railway up --detach` vuelve en cuanto sube el paquete: el build puede
  // fallar después y nadie se entera. Un despliegue fallido es INVISIBLE desde
  // fuera —`/api/health` sigue en 200 y las rutas viejas en 401, porque
  // producción se queda con la imagen anterior—, y el 2026-09-02 se dieron por
  // desplegados tres seguidos que no lo estaban.
  //
  // La señal fiable es `uptimeSec`: un contenedor nuevo lo tiene pequeño.
  esperarQueEntre().catch((e) => {
    console.error('\n  ⚠ ' + e.message);
    process.exit(1);
  });
} else {
  // `frontend/.vercel/` está en .gitignore, así que la copia limpia NO lo
  // trae — y sin ese fichero, `vercel deploy --yes` no encuentra a qué
  // proyecto apunta y CREA UNO NUEVO en vez de actualizar el de siempre.
  // Es configuración local de la máquina, no código: se copia a mano.
  const enlaceOrigen = path.join(process.cwd(), 'frontend', '.vercel');
  const enlaceDestino = path.join(COPIA, 'frontend', '.vercel');
  if (!fs.existsSync(enlaceOrigen)) {
    morir(
      'Esta máquina no tiene enlazado el proyecto de Vercel.',
      `  Falta ${enlaceOrigen}`,
      '    cd frontend && npx vercel link --scope jhonarias888-1963s-projects',
    );
  }
  fs.cpSync(enlaceOrigen, enlaceDestino, { recursive: true });

  // ── Sesión de Vercel aislada ─────────────────────────────────────────────
  //
  // En esta máquina conviven DOS cuentas de Vercel (montiieljaviier y
  // growbusiness) y el CLI guarda el token en UN SOLO sitio:
  // %APPDATA%\com.vercel.cli\Data\auth.json. Entrar con una sobrescribe a la
  // otra, y la que estaba se queda fuera sin avisar — se descubre cuando un
  // despliegue falla con "Not authorized".
  //
  // `--global-config` le da a cada cuenta su propia carpeta. Ahí el CLI guarda
  // y RENUEVA su token por su cuenta, así que las dos sesiones conviven.
  //
  // OJO: la carpeta hay que crearla haciendo `vercel login` DENTRO de ella, no
  // copiando la de al lado. El token es de sesión corta y el original lo va
  // renovando: una copia nace caducada (probado).
  const CONFIG_CLUBIFY = path.join(os.homedir(), '.vercel-clubify');
  const aislada = fs.existsSync(path.join(CONFIG_CLUBIFY, 'auth.json'));
  if (!aislada) {
    console.log(
      `  ⚠ Sin sesión aislada. Se usa la compartida, que la otra cuenta puede\n` +
        `    cerrar en cualquier momento. Para separarlas, una sola vez:\n\n` +
        `      npx vercel login --global-config "${CONFIG_CLUBIFY}"\n`,
    );
  }

  // El proyecto de Vercel vive en el equipo de Jhon: sin --scope, el CLI
  // resuelve el equipo equivocado y devuelve "Not authorized".
  console.log('  Subiendo a Vercel…\n');
  const r = spawnSync(
    'npx',
    [
      'vercel',
      'deploy',
      '--prod',
      '--yes',
      '--scope',
      'jhonarias888-1963s-projects',
      ...(aislada ? ['--global-config', CONFIG_CLUBIFY] : []),
    ],
    { stdio: 'inherit', shell: true, cwd: path.join(COPIA, 'frontend') },
  );
  process.exit(r.status ?? 0);
}


/**
 * Espera a que el backend se reinicie de verdad.
 *
 * Se mira `uptimeSec` y no el estado del build porque es lo ÚNICO que dice si
 * lo que corre es lo que acabas de subir. Y aun así no basta: si otra máquina
 * despliega desde una copia atrasada, el contenedor también es nuevo y tu
 * código no está. Por eso el mensaje pide comprobar una ruta a mano.
 */
async function esperarQueEntre() {
  const SALUD = 'https://api.soyclubify.com/api/health';
  const LIMITE = 12 * 60 * 1000;
  const arranque = Date.now();
  process.stdout.write('\n  Esperando a que entre en producción');

  while (Date.now() - arranque < LIMITE) {
    await new Promise((r) => setTimeout(r, 15000));
    process.stdout.write('.');
    try {
      const res = await fetch(SALUD);
      const j = await res.json();
      // Menos de 5 minutos de vida = contenedor nuevo. El build tarda ~3.
      if (typeof j.uptimeSec === 'number' && j.uptimeSec < 300) {
        console.log('\n\n  ✓ Entró. El backend lleva ' + j.uptimeSec + 's en pie.');
        console.log(
          '    Comprueba una ruta que solo exista en tu commit: si da 404\n' +
            '    mientras otra da 401, tu código NO está arriba.\n',
        );
        return;
      }
    } catch {
      /* reiniciando: se reintenta */
    }
  }

  throw new Error(
    'El backend NO se reinició en 12 minutos: el build falló.\n' +
      '    railway logs --build <id>       → por qué falló el build\n' +
      '    railway logs --deployment <id>  → por qué no arrancó\n' +
      '    Producción sigue con la imagen anterior.',
  );
}

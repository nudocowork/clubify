/**
 * ¿Arranca la aplicación?
 *
 * Compila y la levanta contra una base de datos que no existe. Suena raro, pero
 * es a propósito: NestJS resuelve TODO el grafo de módulos antes de que Prisma
 * intente conectarse, así que un error de inyección sale primero y el fallo de
 * base de datos es la señal de que se llegó hasta el final.
 *
 * Existe porque el 2026-09-02 se desplegó un `ClubService` que inyectaba
 * `WalletService` sin que `ClubModule` importara `WalletModule`. El contenedor
 * moría al arrancar, Railway descartaba el despliegue y producción se quedaba
 * con la imagen anterior — sin que nada lo dijera: `/api/health` seguía en 200
 * y las rutas viejas en 401. Solo las rutas NUEVAS daban 404.
 *
 * Los tests unitarios no cogen esto: construyen los servicios a mano con sus
 * dependencias. El grafo de módulos solo se arma de verdad al arrancar.
 *
 *   npm run arranca          → compila y arranca
 *   npm run arranca -- --sin-compilar
 */
const { execSync, spawn } = require('child_process');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const compilar = !process.argv.includes('--sin-compilar');

if (compilar) {
  console.log('  Compilando…');
  // Se limpia con Node y se llama al compilador directamente, en vez de
  // `npm run build`: ese script empieza por `rm -rf`, que no existe en el shell
  // que usa npm en Windows. En el Dockerfile funciona porque allí es Linux.
  const fs = require('fs');
  fs.rmSync(path.join(RAIZ, 'dist'), { recursive: true, force: true });
  fs.rmSync(path.join(RAIZ, 'tsconfig.tsbuildinfo'), { force: true });
  execSync('npx nest build --tsc', {
    cwd: RAIZ,
    stdio: 'inherit',
    // 7168 y no 4096: con 4 GB el compilador se queda sin memoria en esta
    // máquina —«Ineffective mark-compacts near heap limit»— y el script se
    // vuelve inservible justo cuando más falta hace, antes de desplegar.
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=7168' },
  });
}

console.log('  Arrancando contra una base de datos inexistente…\n');

const hijo = spawn('node', ['dist/main.js'], {
  cwd: RAIZ,
  env: {
    ...process.env,
    // Puerto 1: nadie escucha ahí, y falla rápido en vez de esperar un timeout.
    DATABASE_URL: 'postgresql://x:x@127.0.0.1:1/x',
    PORT: '4977',
    NODE_ENV: 'production',
  },
});

let salida = '';
let terminado = false;

function veredicto(codigo) {
  if (terminado) return;
  terminado = true;
  try {
    hijo.kill();
  } catch {
    /* ya estaba muerto */
  }

  const inyeccion = salida.match(/Nest can't resolve dependencies of the .+/);
  if (inyeccion) {
    console.error(`\n  ✖ NO ARRANCA — falta un import de módulo:\n`);
    console.error(`    ${inyeccion[0]}\n`);
    console.error('    Busca el módulo que declara ese servicio y añádelo a');
    console.error('    los `imports` del módulo que lo inyecta.\n');
    process.exit(1);
  }

  // Llegar hasta el intento de conexión significa que el grafo entero se armó.
  if (/Can't reach database server|PrismaClientInitializationError/.test(salida)) {
    // Se dice exactamente lo que se comprobó y nada más. Contar controladores
    // aquí sería mentir: con la base caída el arranque se detiene ANTES de
    // montar las rutas, así que siempre saldría 0 aunque todo estuviera bien.
    const limpia = salida.replace(/\[[0-9;]*m/g, '');
    const modulos = (limpia.match(/dependencies initialized/g) || []).length;
    console.log(
      `  ✓ El grafo de módulos se arma entero (${modulos} módulos) y llega a` +
        `
    conectarse a la base. Ningún servicio se queda sin resolver.
`,
    );
    process.exit(0);
  }

  console.error('\n  ✖ Terminó sin llegar a la base de datos. Salida completa:\n');
  console.error(salida.split('\n').slice(-40).join('\n'));
  process.exit(codigo || 1);
}

hijo.stdout.on('data', (d) => {
  salida += d;
  if (/PrismaClientInitializationError|Can't reach database server/.test(salida)) {
    veredicto(0);
  }
});
hijo.stderr.on('data', (d) => {
  salida += d;
  if (/Nest can't resolve dependencies/.test(salida)) veredicto(1);
  if (/PrismaClientInitializationError|Can't reach database server/.test(salida)) {
    veredicto(0);
  }
});
hijo.on('exit', (c) => veredicto(c));

// Si en CUATRO minutos no ha dicho ni que arranca ni que falla, algo va mal.
// Eran dos, y con la maquina cargada —otro build, o los tests— la carga del
// AppModule sola pasa del minuto: el script daba por colgado un arranque que
// llegaba bien. Una falsa alarma justo antes de desplegar asusta y hace
// perder el tiempo mas que esperar el doble.
setTimeout(() => {
  salida += '\n[se agotó el tiempo: 240s sin llegar a la base de datos]';
  veredicto(1);
}, 240_000);

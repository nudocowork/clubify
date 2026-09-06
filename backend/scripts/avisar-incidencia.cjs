/**
 * Manda UN SMS a un número, por la subcuenta de la plataforma.
 *
 * Es la misma vía que usan los avisos internos del equipo, así que sale con el
 * remitente de siempre. Se pasa el texto por argumento para no dejar mensajes
 * escritos dentro del repositorio.
 *
 *   railway run node scripts/avisar-incidencia.cjs "+57..." "texto"
 */
const { NestFactory } = require('@nestjs/core');

(async () => {
  const [telefono, texto] = process.argv.slice(2);
  if (!telefono || !texto) {
    console.error('uso: node scripts/avisar-incidencia.cjs "<telefono>" "<texto>"');
    process.exit(1);
  }

  const { AppModule } = require('../dist/app.module');
  const { PreregAlertsService } = require('../dist/auth/prereg-alerts.service');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  try {
    const alerts = app.get(PreregAlertsService);
    const r = await alerts.sendInternalAlert(telefono, texto);
    console.log(r.ok ? 'enviado' : `NO se envió: ${JSON.stringify(r)}`);
    process.exit(r.ok ? 0 : 1);
  } finally {
    await app.close();
  }
})();

// Ejecuta la consulta del Sales Wall contra la base (solo lectura) usando el servicio compilado en memoria con ts-node.
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs' } });
const { PrismaClient } = require('@prisma/client');
const { SalesWallService } = require('../src/sales-wall/sales-wall.service');
const prisma = new PrismaClient();
new SalesWallService(prisma).delMes().then((r) => { console.log(JSON.stringify({ ventas: r.ventas, renovaciones: r.renovaciones, monto_usd: r.monto_usd, servicios: r.servicios }, null, 0)); return; for (const e of r.eventos.slice(0, 40)) console.log(e.fecha.slice(0, 10), e.tipo.padEnd(10), String(e.monto_usd).padStart(6), e.plan.padEnd(18), '|', e.negocio, '| afiliado:', e.afiliado); }).catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());

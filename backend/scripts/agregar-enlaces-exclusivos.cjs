/**
 * Agrega (o actualiza por su `off=`) enlaces de venta EXCLUSIVOS de unos
 * afiliados. Los de Nicolás Quintero con 30 días gratis (2026-10-27).
 * Simula sin --aplicar.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const CODIGOS = ['QZ4ZYHDZ', 'TAFMPWK5'];
const NUEVOS = [
  { id: 'nq-30dias-mensual', nombre: '30 días gratis · Plan mensual', periodicidad: 'MENSUAL', precioUsd: 68, url: 'https://pay.hotmart.com/U102596072A?off=z9480k7o' },
  { id: 'nq-30dias-trimestral', nombre: '30 días gratis · Plan trimestral', periodicidad: 'TRIMESTRAL', precioUsd: 150, url: 'https://pay.hotmart.com/U102596072A?off=autsljm8' },
  { id: 'nq-30dias-semestral', nombre: '30 días gratis · Plan semestral', periodicidad: 'SEMESTRAL', precioUsd: 278, url: 'https://pay.hotmart.com/U102596072A?off=a8wi4mdq' },
  { id: 'nq-30dias-anual', nombre: '30 días gratis · Plan anual', periodicidad: 'ANUAL', precioUsd: 500, url: 'https://pay.hotmart.com/U102596072A?off=553pitk4' },
].map((e) => ({ ...e, tipo: 'PRUEBA', activo: true, soloParaCodigos: CODIGOS }));
const off = (u) => { try { return new URL(u).searchParams.get('off'); } catch { return null; } };
(async () => {
  const aplicar = process.argv.includes('--aplicar');
  const fila = await prisma.setting.findUnique({ where: { key: 'landing.enlacesDeVenta' } });
  const lista = JSON.parse(typeof fila?.value === 'string' ? fila.value : JSON.stringify(fila?.value ?? []));
  for (const n of NUEVOS) {
    const i = lista.findIndex((e) => off(e.url) === off(n.url));
    console.log(`${i >= 0 ? 'actualizo' : 'agrego'}: ${n.nombre} · $${n.precioUsd} · solo ${CODIGOS.join(', ')}`);
    if (i >= 0) lista[i] = { ...lista[i], ...n, id: lista[i].id }; else lista.push(n);
  }
  console.log(`${aplicar ? 'APLICADO' : 'SIMULACIÓN'} · ${lista.length} enlaces en total`);
  if (aplicar) await prisma.setting.update({ where: { key: 'landing.enlacesDeVenta' }, data: { value: JSON.stringify(lista) } });
})().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; }).finally(() => prisma.$disconnect());

// Pedido del gerente (2026-11-04): Contabilidad sin Nicolás Quintero en la
// nómina desde mayo y sin los egresos de «Implementaciones» de jun–oct.
//
// Por qué un script y no el botón «Quitar»: todos esos cortes están PAGADOS, y
// la pantalla (con razón) no deja bajar un corte por debajo de lo abonado. Aquí
// se baja el total Y lo pagado en el mismo monto, así el corte sigue PAGADO y
// cuadrado: esa persona sale de la nómina como si nunca hubiera estado.
//
// Ids fijos, leídos de producción el 2026-11-04. Si una fila ya no existe se
// omite (correrlo dos veces no hace nada); si cambió, se aborta todo.
//
//   node scripts/quitar-nicolas-e-implementaciones.cjs            → simula
//   node scripts/quitar-nicolas-e-implementaciones.cjs --aplicar  → escribe
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const APLICAR = process.argv.includes('--aplicar');

const ITEMS = [ // [payrollItem.id, total esperado]
  ['5bb65476-f654-40dc-add6-ed941a007e06', 323],    // mayo
  ['d359e22c-e550-4bcb-b18c-5ca0962ce332', 342.4],  // junio
  ['0a74d99b-fc7b-4745-9957-5d189b75b49a', 367],    // julio
  ['34702448-ca01-48e8-82a8-859006cdc229', 383],    // agosto
  ['776209a4-fb3c-498b-8be5-8ea8b70b98fe', 192],    // 1-15 sep
  ['25991cb8-5f72-4bbd-845e-128e822a52be', 188.69], // 16-30 sep
  ['b7f7a68c-f47b-4b4c-918c-187c451b362d', 189.05], // 1-15 oct
  ['99e4a957-c4b2-41bb-9db5-21e9c4f899a2', 187.55], // 16-31 oct
];
const EGRESOS = [ // [expense.id, monto esperado]
  ['51dccd4c-490a-490e-9555-faca0414307d', 70.4],   // jun  Implementaciones (19)
  ['d2f2ba49-19aa-431d-afcf-139c9749e5d8', 71],     // jul  Implementaciones (18)
  ['780f45d3-5998-4503-8268-5b7972de0c86', 120.44], // ago  Implementaciones (29)
  ['6d1d4e23-4a54-4bf7-b2f3-01db3fb22f63', 65.4],   // sep  Implementaciones
  ['26b26c21-7c89-4d57-8048-e9e6a7432fb4', 13],     // oct  Bono Implementaciones
];
const r2 = (n) => Math.round(n * 100) / 100;
const casa = (a, b) => Math.abs(Number(a) - b) < 0.005;

(async () => {
  console.log(APLICAR ? '== APLICANDO ==' : '== SIMULACIÓN (usa --aplicar para escribir) ==');
  // Respaldo de lo que se borra, para poder reponerlo si el gerente se arrepiente.
  const respaldo = { items: [], runs: [], egresos: [] };

  await p.$transaction(async (tx) => {
    for (const [id, esperado] of ITEMS) {
      const it = await tx.payrollItem.findUnique({ where: { id }, include: { run: true } });
      if (!it) { console.log('· ítem', id, 'ya no existe — se omite'); continue; }
      if (!/nicol/i.test(it.employeeName) || !casa(it.totalUsd, esperado)) {
        throw new Error(`ítem ${id} no es el esperado: ${it.employeeName} ${it.totalUsd}`);
      }
      const run = it.run;
      const total = r2(Number(run.totalUsd) - Number(it.totalUsd));
      const pagado = r2(Math.max(0, Number(run.amountPaidUsd) - Number(it.totalUsd)));
      const { run: _r, ...soloItem } = it;
      respaldo.items.push(soloItem);
      respaldo.runs.push({ id: run.id, totalUsd: String(run.totalUsd), amountPaidUsd: String(run.amountPaidUsd), status: run.status });
      console.log(`- ${run.periodLabel}: quita ${it.employeeName} $${it.totalUsd} → total ${run.totalUsd}→${total}, pagado ${run.amountPaidUsd}→${pagado} (${run.status})`);
      if (!APLICAR) continue;
      await tx.payrollItem.delete({ where: { id } });
      // Comprobar contra las líneas que quedan, no fiarse de la resta.
      const quedan = await tx.payrollItem.findMany({ where: { runId: run.id }, select: { totalUsd: true } });
      const suma = r2(quedan.reduce((a, q) => a + Number(q.totalUsd), 0));
      if (!casa(suma, total)) throw new Error(`corte ${run.periodLabel}: líneas suman ${suma}, esperaba ${total}`);
      await tx.payrollRun.update({ where: { id: run.id }, data: { totalUsd: total, amountPaidUsd: pagado } });
    }
    for (const [id, esperado] of EGRESOS) {
      const e = await tx.expense.findUnique({ where: { id } });
      if (!e) { console.log('· egreso', id, 'ya no existe — se omite'); continue; }
      if (!/mplementac/i.test(e.concept) || !casa(e.amountUsd, esperado)) {
        throw new Error(`egreso ${id} no es el esperado: ${e.concept} ${e.amountUsd}`);
      }
      respaldo.egresos.push(e);
      console.log(`- egreso ${e.expenseDate.toISOString().slice(0, 10)} «${e.concept}» $${e.amountUsd} → se borra`);
      if (APLICAR) await tx.expense.delete({ where: { id } });
    }
  }, { timeout: 60000 });

  console.log('\nRESPALDO (guárdalo):');
  console.log(JSON.stringify(respaldo));
  console.log(APLICAR ? '\nHecho.' : '\nNada se escribió.');
  await p.$disconnect();
})().catch(async (e) => { console.error('ERROR, no se escribió nada:', e.message); await p.$disconnect(); process.exit(1); });

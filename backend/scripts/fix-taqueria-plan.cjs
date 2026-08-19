const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const COMMIT = process.argv.includes('--commit');
const d=(x)=>x?new Date(x).toISOString().slice(0,16):'—';
const T='0a3f3085-afbb-47f9-828f-a6d25e69f2da';
(async()=>{
  const t = await p.tenant.findUnique({ where:{id:T}, select:{brandName:true,planPeriodicity:true,lastChargeAt:true,currentPeriodEnd:true,subscriptionPriceUsd:true} });
  const base = t.lastChargeAt ? new Date(t.lastChargeAt) : new Date();
  const npe = new Date(base); npe.setMonth(npe.getMonth()+3);
  console.log(`${t.brandName}: plan ${t.planPeriodicity}→TRIMESTRAL · currentPeriodEnd ${d(t.currentPeriodEnd)}→${d(npe)} · subPriceUsd=${t.subscriptionPriceUsd??'null(→canónico $150)'}`);
  const before = await p.commission.count();
  if(!COMMIT){console.log(`(DRY-RUN) comisiones=${before} · --commit para aplicar (solo toca el tenant, NO comisiones)`);await p.$disconnect();return;}
  await p.tenant.update({ where:{id:T}, data:{ planPeriodicity:'TRIMESTRAL', currentPeriodEnd:npe } });
  const after = await p.commission.count();
  console.log(`✅ plan corregido. comisiones ${before}→${after} ${before===after?'(igual ✓)':'⚠️'}`);
  await p.$disconnect();
})().catch(e=>{console.error(e.message);process.exit(1)});

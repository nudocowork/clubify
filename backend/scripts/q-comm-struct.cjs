const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const d=(x)=>x?new Date(x).toISOString().slice(0,16):'—';
(async()=>{
  console.log('=== Comisión(es) $ a TAFMPWK5 hoy — estructura de links ===');
  const c = await p.commission.findMany({
    where: { recipientCode: { code: 'TAFMPWK5' }, createdAt: { gte: new Date('2026-08-17T00:00:00Z') } },
    select: { id:true, amount:true, status:true, referralUseId:true, businessGroupId:true, recipientCodeId:true,
      hotmartTransactionId:true, externalTxId:true, businessDate:true, createdAt:true },
    orderBy:{createdAt:'desc'},
  });
  for (const x of c) console.log(`  comm ${x.id} $${Number(x.amount)} [${x.status}] · referralUseId=${x.referralUseId??'NULL'} · businessGroupId=${x.businessGroupId??'NULL'} · tx=${x.hotmartTransactionId??x.externalTxId??'—'} · biz=${d(x.businessDate)} · created=${d(x.createdAt)}`);

  console.log('\n=== ReferralUses de TAFMPWK5 (todos) ===');
  const uses = await p.referralUse.findMany({
    where: { referralCode: { code: 'TAFMPWK5' } },
    select: { id:true, tenantId:true, status:true, createdAt:true, tenant:{select:{brandName:true,email:true}} },
    orderBy:{createdAt:'desc'}, take:8,
  });
  console.log(`  total (top 8 de ${uses.length}):`);
  for (const u of uses) console.log(`    use ${u.id} [${u.status}] tenantId=${u.tenantId??'NULL'} → ${u.tenant?.brandName??'—'}(${u.tenant?.email??'—'}) created=${d(u.createdAt)}`);
  await p.$disconnect();
})().catch(e=>{console.error(e.message);process.exit(1)});

const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const d=(x)=>x?new Date(x).toISOString().slice(0,16):'—';
(async()=>{
  const c = await p.commission.findMany({
    where: { OR: [
      { hotmartTransactionId: { in: ['HP0111081272','HPBB47268559'] } },
      { externalTxId: { in: ['HP0111081272','HPBB47268559'] } },
      { recipientCode: { code: 'TAFMPWK5' }, createdAt: { gte: new Date('2026-08-17T00:00:00Z') } },
    ]},
    select: { id:true, amount:true, status:true, businessDate:true, createdAt:true, hotmartTransactionId:true, externalTxId:true,
      recipientCode:{select:{code:true,ownerName:true}},
      referralUse:{select:{id:true, tenantId:true, tenant:{select:{brandName:true,email:true}}, referralCode:{select:{code:true,ownerName:true}}}} },
    orderBy:{createdAt:'desc'}, take:10,
  });
  console.log('Comisiones relacionadas ('+c.length+'):');
  for(const x of c) console.log(`  $${Number(x.amount)} [${x.status}] biz=${d(x.businessDate)} tx=${x.hotmartTransactionId??x.externalTxId??'—'} → recip=${x.recipientCode?.ownerName}(${x.recipientCode?.code}) · use.tenant=${x.referralUse?.tenant?.brandName??'—'}(${x.referralUse?.tenant?.email??'—'}) via=${x.referralUse?.referralCode?.code??'—'}`);
  await p.$disconnect();
})().catch(e=>{console.error(e.message);process.exit(1)});

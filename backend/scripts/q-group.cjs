const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const d=(x)=>x?new Date(x).toISOString().slice(0,16):'—';
(async()=>{
  const T='0a3f3085-afbb-47f9-828f-a6d25e69f2da';
  const G='d985eea7-1876-4962-beda-2dbb9bc20d30';
  const t = await p.tenant.findUnique({ where:{id:T}, select:{brandName:true, businessGroupId:true} });
  console.log(`Taquería businessGroupId = ${t?.businessGroupId ?? 'NULL'} ${t?.businessGroupId===G?'(= el grupo de la comisión ✓)':''}`);
  const g = await p.businessGroup.findUnique({ where:{id:G}, select:{ id:true, name:true, planPeriodicity:true, priceUsd:true, status:true, lastChargeAt:true,
    referralCodeId:true, referralCode:{select:{code:true,ownerName:true}},
    tenants:{select:{brandName:true,email:true,planPeriodicity:true,lastChargeAt:true}} } });
  if(!g){console.log('grupo no existe');}else{
    console.log(`\nGrupo "${g.name}" [${g.status}] ${g.planPeriodicity} priceUsd=${g.priceUsd} lastChargeAt=${d(g.lastChargeAt)}`);
    console.log(`  afiliado del grupo: ${g.referralCode?.ownerName} (${g.referralCode?.code})`);
    console.log(`  negocios del grupo (${g.tenants.length}):`);
    for(const x of g.tenants) console.log(`    - ${x.brandName} (${x.email}) plan=${x.planPeriodicity} lastCharge=${d(x.lastChargeAt)}`);
  }
  await p.$disconnect();
})().catch(e=>{console.error(e.message);process.exit(1)});

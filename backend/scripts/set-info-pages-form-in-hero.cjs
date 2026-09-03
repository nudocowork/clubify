// Activa theme.formInHero en /informacion e /informacion1 → el formulario se ve de
// inmediato en el primer bloque (hero) del clon, en vez de solo el popup "Contactar".
// NO toca el texto legal ni el consentimiento (eso se configura aparte). Respalda.
// Correr: railway run --service Postgres-Nq8w node scripts/set-info-pages-form-in-hero.cjs --apply
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const SLUGS = ["informacion", "informacion1"];
const BACKUP_DIR = "/private/tmp/claude-501/-Users-jhonarias-Documents-AGENTES-CLUBIFY/6fbd101b-4ec6-4408-bdcb-05169736a0f1/scratchpad";

(async () => {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error("❌ No DATABASE_URL."); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const ts = Date.now();
  console.log(apply ? "🟢 APLICAR\n" : "🟡 DRY-RUN\n");
  for (const slug of SLUGS) {
    const page = await prisma.infoPage.findUnique({ where: { slug } });
    if (!page) { console.log(`⚠️  /${slug} no existe.`); continue; }
    const prevTheme = (page.theme && typeof page.theme === "object") ? page.theme : {};
    const nextTheme = { ...prevTheme, formInHero: true };
    console.log(`── /${slug} · formInHero=true (template=${prevTheme.template || "—"})`);
    if (apply) {
      fs.writeFileSync(`${BACKUP_DIR}/infopage-${slug}-preheroform-${ts}.json`, JSON.stringify(page, null, 2));
      await prisma.infoPage.update({ where: { slug }, data: { theme: nextTheme } });
      console.log("   ✅ Formulario en el primer bloque activado.");
    }
  }
  await prisma.$disconnect();
  console.log(apply ? "\n✅ Listo (ISR ~60s)." : "\n🟡 Dry-run. Usa --apply.");
})().catch((e) => { console.error(e); process.exit(1); });

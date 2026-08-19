// Convierte /informacion e /informacion1 en el formulario de contacto "Gastrofusión 2026":
//   - Quita el customHtml (landing de sorteo actual) → RESPALDO antes de escribir.
//   - CTA "Contactar" en POPUP con 6 campos.
//   - Al enviar → lead con etiqueta "Gastrofusion 2026" → redirige a WhatsApp 573189554627.
// NO cambia isPublished. Preserva logoUrl/heroImageUrl.
//
// Respaldo: escribe el row completo previo a <BACKUP_DIR>/infopage-<slug>-<ts>.json
// Correr:  railway run --service Postgres-Nq8w node scripts/set-gastrofusion-info-pages.cjs
//   (dry-run por defecto)
// Aplicar: railway run --service Postgres-Nq8w node scripts/set-gastrofusion-info-pages.cjs --apply
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");

const SLUGS = ["informacion", "informacion1"];
const TAG = "Gastrofusion 2026";
const CTA = "Contactar";
const WA = "573189554627";
const WA_MSG = "Hola, me interesa saber más";
const ACCENT = "#e11d48";
const TITLE = "Gastrofusión";
const SUBTITLE = "Déjanos tus datos y nuestro equipo te contacta.";
const BACKUP_DIR = "/private/tmp/claude-501/-Users-jhonarias-Documents-AGENTES-CLUBIFY/6fbd101b-4ec6-4408-bdcb-05169736a0f1/scratchpad";

const FIELDS = [
  { key: "nombre", label: "Nombre", type: "text", required: true },
  { key: "negocio", label: "Nombre del negocio", type: "text", required: true },
  { key: "instagram", label: "Perfil de Instagram", type: "text", required: false },
  { key: "contacto", label: "Número de contacto", type: "tel", required: true },
  { key: "ubicacion", label: "Ubicación", type: "text", required: true },
  { key: "sedes", label: "Cantidad de sedes", type: "number", required: false },
];

(async () => {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error("❌ No DATABASE_URL / DATABASE_PUBLIC_URL."); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const ts = Date.now();

  console.log(apply ? "🟢 MODO APLICAR\n" : "🟡 DRY-RUN (usa --apply para escribir)\n");

  for (const slug of SLUGS) {
    const page = await prisma.infoPage.findUnique({ where: { slug } });
    if (!page) { console.log(`⚠️  /${slug} no existe, se omite.\n`); continue; }

    const prevTheme = (page.theme && typeof page.theme === "object") ? page.theme : {};
    // Quita customHtml + raffleSlug (el landing de sorteo) y arma el theme del formulario.
    const { customHtml, raffleSlug, ...restTheme } = prevTheme;
    const nextTheme = {
      ...restTheme,
      primaryColor: restTheme.primaryColor || ACCENT,
      formPopup: true,
      leadWhatsapp: WA,
      leadWhatsappMsg: WA_MSG,
    };

    console.log(`── /${slug} (publicada: ${page.isPublished ? "sí" : "no"}) ──`);
    console.log(`   customHtml previo: ${customHtml ? `${String(customHtml).length} chars → SE QUITA` : "(ninguno)"}`);
    console.log(`   ctaText:  ${JSON.stringify(page.ctaText)}  →  ${JSON.stringify(CTA)}`);
    console.log(`   tag:      ${JSON.stringify(page.tag)}  →  ${JSON.stringify(TAG)}`);
    console.log(`   title:    ${JSON.stringify(page.title)}  →  ${JSON.stringify(TITLE)}`);
    console.log(`   campos:   ${(page.formFields || []).length}  →  ${FIELDS.length} (${FIELDS.map((f) => f.key).join(", ")})`);
    console.log(`   theme:    formPopup=true wa=${WA} color=${nextTheme.primaryColor}`);

    if (apply) {
      // Respaldo del row completo ANTES de escribir.
      const bpath = `${BACKUP_DIR}/infopage-${slug}-${ts}.json`;
      fs.writeFileSync(bpath, JSON.stringify(page, null, 2));
      console.log(`   💾 respaldo: ${bpath}`);

      await prisma.infoPage.update({
        where: { slug },
        data: {
          title: TITLE,
          subtitle: SUBTITLE,
          description: "",
          sections: [],
          ctaText: CTA,
          ctaUrl: null,
          tag: TAG,
          formEnabled: true,
          formFields: FIELDS,
          theme: nextTheme,
        },
      });
      console.log("   ✅ Convertida a formulario de contacto.");
    }
    console.log("");
  }

  await prisma.$disconnect();
  console.log(apply ? "✅ Listo." : "🟡 Dry-run terminado. Corre con --apply para escribir.");
})().catch((e) => { console.error(e); process.exit(1); });

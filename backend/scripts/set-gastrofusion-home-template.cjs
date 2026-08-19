// Convierte /informacion e /informacion1 en un CLON de la portada soyclubify.com
// ("Una plataforma todo en uno para tu negocio local" + trío de iPhones), con el
// CTA "Contactar" → formulario emergente → WhatsApp (+57 318 955 4627).
// Activa theme.template='clubify-home' (lo renderiza InfoPageView con HeroTrio) y
// RESPALDA + QUITA el customHtml anterior (landing oscuro). Preserva el resto del theme.
// Correr:  railway run --service Postgres-Nq8w node scripts/set-gastrofusion-home-template.cjs --apply
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");

const SLUGS = ["informacion", "informacion1"];
const BACKUP_DIR = "/private/tmp/claude-501/-Users-jhonarias-Documents-AGENTES-CLUBIFY/6fbd101b-4ec6-4408-bdcb-05169736a0f1/scratchpad";

const LEAD_WHATSAPP = "573189554627";
const SUBTITLE = "Tarjetas de fidelización, menú digital, CRM de pedidos y automatizaciones de delivery.";
const CTA = "Contactar";

// Formulario de contacto (Gastrofusión). Se conserva si ya existe uno con campos.
const DEFAULT_FIELDS = [
  { key: "nombre", label: "Nombre", type: "text", required: true },
  { key: "negocio", label: "Nombre del negocio", type: "text", required: true },
  { key: "instagram", label: "Perfil de Instagram", type: "text" },
  { key: "whatsapp", label: "Número de contacto (WhatsApp)", type: "tel", required: true },
  { key: "ubicacion", label: "Ubicación (ciudad)", type: "text" },
  { key: "sedes", label: "Cantidad de sedes", type: "number" },
];

(async () => {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error("❌ No DATABASE_URL."); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const ts = Date.now();
  console.log(apply ? "🟢 APLICAR\n" : "🟡 DRY-RUN\n", `template=clubify-home wa=${LEAD_WHATSAPP}\n`);

  for (const slug of SLUGS) {
    const page = await prisma.infoPage.findUnique({ where: { slug } });
    if (!page) { console.log(`⚠️  /${slug} no existe.\n`); continue; }
    const prevTheme = (page.theme && typeof page.theme === "object") ? { ...page.theme } : {};
    const hadHtml = !!prevTheme.customHtml;
    delete prevTheme.customHtml; // el clon reemplaza al landing oscuro
    const nextTheme = {
      ...prevTheme,
      template: "clubify-home",
      formPopup: true,
      leadWhatsapp: LEAD_WHATSAPP,
      leadWhatsappMsg: prevTheme.leadWhatsappMsg || "Hola, me interesa saber más",
    };
    const hasFields = Array.isArray(page.formFields) && page.formFields.length > 0;
    const nextData = {
      theme: nextTheme,
      ctaText: CTA,
      subtitle: SUBTITLE,
      formEnabled: true,
      ...(hasFields ? {} : { formFields: DEFAULT_FIELDS }),
    };
    console.log(`── /${slug} · template=clubify-home · quitaHtml=${hadHtml} · fields=${hasFields ? "conserva" : "setea 6"} · wa=${LEAD_WHATSAPP}`);
    if (apply) {
      fs.writeFileSync(`${BACKUP_DIR}/infopage-${slug}-prehome-${ts}.json`, JSON.stringify(page, null, 2));
      await prisma.infoPage.update({ where: { slug }, data: nextData });
      console.log("   ✅ Clon de portada activado.");
    }
  }
  await prisma.$disconnect();
  console.log(apply ? "\n✅ Listo. Propaga en ~60s (ISR)." : "\n🟡 Dry-run. Usa --apply.");
})().catch((e) => { console.error(e); process.exit(1); });

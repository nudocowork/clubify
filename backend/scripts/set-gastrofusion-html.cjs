// Carga un landing de marca "Gastrofusión" (theme.customHtml) en /informacion e
// /informacion1. Los CTA usan href="#contactar" → los cablea InfoPageView al popup
// del formulario de contacto (lead [Gastrofusion 2026] → WhatsApp). Preserva el resto
// del theme (formPopup/leadWhatsapp/etc). RESPALDA el row previo antes de escribir.
// Correr:  railway run --service Postgres-Nq8w node scripts/set-gastrofusion-html.cjs --apply
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");

const SLUGS = ["informacion", "informacion1"];
const BACKUP_DIR = "/private/tmp/claude-501/-Users-jhonarias-Documents-AGENTES-CLUBIFY/6fbd101b-4ec6-4408-bdcb-05169736a0f1/scratchpad";

const HTML = `
<div class="gf">
  <style>
    .gf{--ink:#1b1310;--cream:#fbf4ec;--accent:#e11d48;--accent2:#ff6b3d;--gold:#e0a64b;--muted:#8a7d74;font-family:'Figtree',system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--ink);line-height:1.5;-webkit-font-smoothing:antialiased}
    .gf *{box-sizing:border-box;margin:0}
    .gf-wrap{max-width:1040px;margin:0 auto;padding:0 24px}
    .gf-hero{position:relative;overflow:hidden;background:radial-gradient(900px 460px at 78% -8%,rgba(255,107,61,.35),transparent 60%),radial-gradient(700px 420px at 10% 110%,rgba(225,29,72,.28),transparent 60%),linear-gradient(160deg,#241611,#140c09);color:var(--cream);padding:88px 0 96px}
    .gf-eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--gold);background:rgba(224,166,75,.12);border:1px solid rgba(224,166,75,.3);padding:7px 14px;border-radius:999px}
    .gf-h1{margin-top:22px;font-size:clamp(34px,6vw,60px);font-weight:800;line-height:1.05;letter-spacing:-.02em;max-width:16ch}
    .gf-h1 em{font-style:normal;background:linear-gradient(120deg,var(--accent2),var(--gold));-webkit-background-clip:text;background-clip:text;color:transparent}
    .gf-sub{margin-top:20px;font-size:clamp(16px,2.2vw,20px);color:rgba(251,244,236,.82);max-width:56ch}
    .gf-cta{display:inline-flex;align-items:center;gap:10px;margin-top:34px;background:linear-gradient(120deg,var(--accent),var(--accent2));color:#fff;font-weight:700;font-size:16px;padding:16px 30px;border-radius:14px;text-decoration:none;box-shadow:0 14px 34px -12px rgba(225,29,72,.7);transition:transform .15s ease,box-shadow .15s ease;cursor:pointer;border:0}
    .gf-cta:hover{transform:translateY(-2px);box-shadow:0 20px 40px -12px rgba(225,29,72,.8)}
    .gf-cta.alt{background:#fff;color:var(--ink);box-shadow:0 14px 34px -14px rgba(0,0,0,.4)}
    .gf-note{margin-top:16px;font-size:13px;color:rgba(251,244,236,.6)}
    .gf-feats{background:var(--cream);padding:72px 0}
    .gf-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:8px}
    .gf-card{background:#fff;border:1px solid #efe4d8;border-radius:20px;padding:26px;box-shadow:0 20px 40px -32px rgba(60,30,10,.5)}
    .gf-ic{width:52px;height:52px;display:grid;place-items:center;font-size:26px;border-radius:14px;background:linear-gradient(135deg,rgba(255,107,61,.16),rgba(224,166,75,.16))}
    .gf-card h3{margin-top:16px;font-size:19px;font-weight:800}
    .gf-card p{margin-top:8px;color:var(--muted);font-size:15px}
    .gf-kicker{font-size:13px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--accent)}
    .gf-feats h2{margin-top:10px;font-size:clamp(26px,4vw,38px);font-weight:800;letter-spacing:-.01em;max-width:20ch}
    .gf-band{background:linear-gradient(160deg,#241611,#140c09);color:var(--cream);padding:72px 0;text-align:center}
    .gf-band h2{font-size:clamp(24px,4vw,36px);font-weight:800;max-width:22ch;margin:0 auto}
    .gf-band p{margin-top:12px;color:rgba(251,244,236,.75)}
    .gf-foot{background:#140c09;color:rgba(251,244,236,.5);text-align:center;padding:26px;font-size:13px}
    @media(max-width:760px){.gf-grid{grid-template-columns:1fr}.gf-hero{padding:64px 0 72px}.gf-feats,.gf-band{padding:56px 0}}
  </style>

  <header class="gf-hero">
    <div class="gf-wrap">
      <span class="gf-eyebrow">🍽️ Gastrofusión 2026</span>
      <h1 class="gf-h1">El sabor de tu negocio, <em>al siguiente nivel</em></h1>
      <p class="gf-sub">Fideliza, vende y automatiza tu restaurante o negocio gastronómico. Tarjeta de sellos, menú digital, pedidos y campañas por WhatsApp — todo en un solo lugar.</p>
      <a href="#contactar" class="gf-cta">Contactar →</a>
      <p class="gf-note">Te contactamos por WhatsApp en minutos.</p>
    </div>
  </header>

  <section class="gf-feats">
    <div class="gf-wrap">
      <p class="gf-kicker">Todo lo que tu cocina necesita</p>
      <h2>Más clientes que vuelven, menos trabajo manual</h2>
      <div class="gf-grid">
        <div class="gf-card"><div class="gf-ic">🎟️</div><h3>Fideliza</h3><p>Tarjeta de sellos y premios que hacen volver a tus comensales una y otra vez.</p></div>
        <div class="gf-card"><div class="gf-ic">📲</div><h3>Vende más</h3><p>Menú digital, pedidos y pagos desde el celular, sin comisiones abusivas.</p></div>
        <div class="gf-card"><div class="gf-ic">⚡</div><h3>Automatiza</h3><p>Campañas y recordatorios por WhatsApp que trabajan por ti, en piloto automático.</p></div>
      </div>
    </div>
  </section>

  <section class="gf-band">
    <div class="gf-wrap">
      <h2>¿Listo para hacer crecer tu negocio gastronómico?</h2>
      <p>Déjanos tus datos y un asesor te contacta hoy mismo.</p>
      <div style="margin-top:26px"><a href="#contactar" class="gf-cta alt">Contactar ahora</a></div>
    </div>
  </section>

  <footer class="gf-foot">Gastrofusión · soyclubify.com</footer>
</div>
`;

(async () => {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!url) { console.error("❌ No DATABASE_URL."); process.exit(1); }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const ts = Date.now();
  console.log(apply ? "🟢 APLICAR\n" : "🟡 DRY-RUN\n", `HTML: ${HTML.length} chars\n`);

  for (const slug of SLUGS) {
    const page = await prisma.infoPage.findUnique({ where: { slug } });
    if (!page) { console.log(`⚠️  /${slug} no existe.\n`); continue; }
    const prevTheme = (page.theme && typeof page.theme === "object") ? page.theme : {};
    const nextTheme = { ...prevTheme, customHtml: HTML, formPopup: true };
    console.log(`── /${slug} · formPopup=${nextTheme.formPopup} wa=${nextTheme.leadWhatsapp} customHtml=${HTML.length}c`);
    if (apply) {
      fs.writeFileSync(`${BACKUP_DIR}/infopage-${slug}-prehtml-${ts}.json`, JSON.stringify(page, null, 2));
      await prisma.infoPage.update({ where: { slug }, data: { theme: nextTheme } });
      console.log("   ✅ HTML de marca cargado.");
    }
  }
  await prisma.$disconnect();
  console.log(apply ? "\n✅ Listo." : "\n🟡 Dry-run. Usa --apply.");
})().catch((e) => { console.error(e); process.exit(1); });

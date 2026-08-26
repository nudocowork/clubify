/**
 * Genera `docs/plantillas-correo/preview.html`: todas las plantillas de
 * fábrica renderizadas en una grilla, para revisarlas de un vistazo en el
 * navegador sin base de datos ni sesión.
 *
 * La hoja trae los anchos del criterio de aceptación (320 / 480 / 600) más el
 * de escritorio, y el fallback de texto plano de cada plantilla, que es lo que
 * no se puede comprobar mirando solo el HTML. A 620 px o menos las columnas se
 * apilan a propósito: por eso el ancho por defecto es 700.
 *
 * Uso:  node scripts/preview-email-templates.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { renderAll } = require('./lib/email-presets.cjs');

const SALIDA = path.resolve(__dirname, '../../docs/plantillas-correo/preview.html');

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const listas = renderAll();

const tarjetas = listas
  .map(
    (t, i) => `
    <section class="tarjeta">
      <header>
        <h2>${esc(t.name)}</h2>
        <p class="asunto">Asunto: <b>${esc(t.subject || '—')}</b></p>
        <p class="pre">Vista previa: ${esc(t.doc.settings.preheader || '—')}</p>
      </header>
      <div class="marco">
        <iframe title="${esc(t.name)}" loading="lazy" srcdoc="${esc(t.html)}"></iframe>
      </div>
      <details>
        <summary>Fallback de texto plano (${t.texto.length} caracteres)</summary>
        <pre>${esc(t.texto)}</pre>
      </details>
      <p class="meta">${t.html.length.toLocaleString('es')} bytes · plantilla ${i + 1} de ${listas.length}</p>
    </section>`,
  )
  .join('\n');

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Plantillas de correo de fábrica — Clubify PRO</title>
<style>
  :root { --borde:#e5e7eb; --tinta:#111827; --suave:#6b7280; --acento:#4f46e5; }
  * { box-sizing: border-box; }
  body { margin:0; background:#f4f5f7; color:var(--tinta);
         font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; }
  header.top { position:sticky; top:0; z-index:5; background:#fff; border-bottom:1px solid var(--borde);
               padding:14px 20px; display:flex; flex-wrap:wrap; gap:14px; align-items:center; }
  header.top h1 { margin:0; font-size:17px; }
  header.top p { margin:0; font-size:13px; color:var(--suave); }
  .anchos { margin-left:auto; display:flex; gap:6px; }
  .anchos button { border:1px solid var(--borde); background:#fff; border-radius:8px;
                   padding:7px 14px; font-size:13px; font-weight:600; cursor:pointer; }
  .anchos button[aria-pressed="true"] { background:var(--acento); border-color:var(--acento); color:#fff; }
  main { display:grid; gap:22px; padding:22px;
         grid-template-columns:repeat(auto-fill, minmax(min(100%, 640px), 1fr)); }
  .tarjeta { background:#fff; border:1px solid var(--borde); border-radius:12px; overflow:hidden; }
  .tarjeta > header { padding:14px 16px; border-bottom:1px solid var(--borde); }
  .tarjeta h2 { margin:0 0 4px; font-size:15px; }
  .asunto, .pre { margin:0; font-size:12px; color:var(--suave); }
  .marco { background:#f4f5f7; padding:16px; display:flex; justify-content:center; }
  iframe { width:700px; max-width:100%; height:900px; border:0; background:#fff;
           box-shadow:0 1px 3px rgba(0,0,0,.12); transition:width .15s ease; }
  details { border-top:1px solid var(--borde); }
  summary { padding:10px 16px; font-size:12px; color:var(--suave); cursor:pointer; }
  pre { margin:0; padding:0 16px 14px; font-size:12px; line-height:1.6; white-space:pre-wrap; color:#374151; }
  .meta { margin:0; padding:10px 16px; border-top:1px solid var(--borde); font-size:11px; color:#9ca3af; }
</style>
</head>
<body>
<header class="top">
  <div>
    <h1>Plantillas de correo de fábrica</h1>
    <p>${listas.length} plantillas · generado desde <code>backend/scripts/lib/email-presets.cjs</code>
       · a 620 px o menos las columnas se apilan a propósito</p>
  </div>
  <div class="anchos">
    <button data-w="320">320 px</button>
    <button data-w="480">480 px</button>
    <button data-w="600">600 px</button>
    <button data-w="700" aria-pressed="true">Escritorio</button>
  </div>
</header>
<main>
${tarjetas}
</main>
<script>
  // El iframe reencuadra y las media queries del correo se disparan igual que
  // en un cliente real, así que esto comprueba el responsive de verdad.
  const botones = document.querySelectorAll('.anchos button');
  botones.forEach((btn) => {
    btn.addEventListener('click', () => {
      botones.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      document.querySelectorAll('iframe').forEach((f) => { f.style.width = btn.dataset.w + 'px'; });
    });
  });
</script>
</body>
</html>
`;

fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(SALIDA, html, 'utf8');
console.log(`✓ ${listas.length} plantillas → ${path.relative(process.cwd(), SALIDA)} (${Math.round(html.length / 1024)} KB)`);

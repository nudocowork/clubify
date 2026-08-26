/**
 * Genera la hoja de revisión de las plantillas de fábrica: las 9 renderizadas,
 * a los anchos del criterio de aceptación, con su fallback de texto plano.
 * Sin base de datos ni sesión.
 *
 * Escribe el documento completo en `docs/plantillas-correo/preview.html`, para
 * abrir de un doble clic. Si se le pasa una carpeta como argumento, escribe
 * además ahí `preview-artifact.html`: el mismo cuerpo sin `<html>`/`<head>`,
 * que es lo que admite el publicador de artifacts.
 *
 * A 620 px o menos las columnas se apilan por diseño (la media query del
 * correo): por eso el ancho por defecto es el de escritorio y no 600.
 *
 * Uso:  node scripts/preview-email-templates.cjs [carpeta-del-artifact]
 */
const fs = require('node:fs');
const path = require('node:path');
const { renderAll, bloquesDe } = require('./lib/email-presets.cjs');

const SALIDA = path.resolve(__dirname, '../../docs/plantillas-correo/preview.html');
const SALIDA_ARTIFACT = process.argv[2] ? path.resolve(process.argv[2], 'preview-artifact.html') : null;

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const id = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const listas = renderAll();

// ── Estilos ────────────────────────────────────────────────────────────────
// El cromo de esta página tiene que DESAPARECER: dentro conviven 9 paletas
// distintas y cualquier color fuerte aquí compite con lo que se está juzgando.
// De ahí neutros con sesgo frío y un solo índigo, apagado, para lo interactivo.
const FUENTES =
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" />';

const ESTILOS = `
  :root {
    --ground:    #edeff4;
    --surface:   #ffffff;
    --sunken:    #e4e7ee;
    --ink:       #161922;
    --muted:     #616978;
    --hairline:  #dbdfe8;
    --accent:    #3b37b8;
    --on-accent: #ffffff;
    --chip:      #eef0f7;
    --display: 'Archivo', 'Segoe UI', system-ui, sans-serif;
    --mono: 'IBM Plex Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground:    #0d0f15;
      --surface:   #161a22;
      --sunken:    #10131a;
      --ink:       #e4e7ee;
      --muted:     #939bab;
      --hairline:  #242935;
      --accent:    #9c97ff;
      --on-accent: #14121f;
      --chip:      #1e2330;
    }
  }
  :root[data-theme="dark"] {
    --ground:    #0d0f15;
    --surface:   #161a22;
    --sunken:    #10131a;
    --ink:       #e4e7ee;
    --muted:     #939bab;
    --hairline:  #242935;
    --accent:    #9c97ff;
    --on-accent: #14121f;
    --chip:      #1e2330;
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--ground);
    color: var(--ink);
    font-family: var(--display);
    font-size: 15px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }

  /* ── Barra de instrumentos ── */
  .barra {
    position: sticky; top: 0; z-index: 20;
    display: flex; flex-wrap: wrap; align-items: center; gap: 18px;
    padding: 14px 24px;
    background: var(--surface);
    border-bottom: 1px solid var(--hairline);
  }
  .marca { display: flex; flex-direction: column; gap: 2px; margin-right: auto; }
  .marca h1 { margin: 0; font-size: 16px; font-weight: 700; letter-spacing: -0.01em; text-wrap: balance; }
  .marca p { margin: 0; font-size: 12.5px; color: var(--muted); }
  .conmutador { display: flex; align-items: center; gap: 10px; }
  .conmutador > span {
    font-size: 10.5px; font-weight: 600; letter-spacing: 0.09em;
    text-transform: uppercase; color: var(--muted);
  }
  .anchos { display: flex; gap: 2px; padding: 3px; background: var(--sunken); border-radius: 9px; }
  .anchos button {
    font: 500 12.5px/1 var(--mono);
    padding: 8px 13px; border: 0; border-radius: 6px; cursor: pointer;
    background: transparent; color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .anchos button:hover { color: var(--ink); }
  .anchos button[aria-pressed="true"] { background: var(--accent); color: var(--on-accent); }

  /* ── Cuerpo ── */
  .cuerpo { display: grid; grid-template-columns: 208px minmax(0, 1fr); gap: 28px; padding: 28px 24px 72px; }
  @media (max-width: 900px) { .cuerpo { grid-template-columns: minmax(0, 1fr); gap: 18px; } }

  .indice { position: sticky; top: 86px; align-self: start; }
  .indice h2 {
    margin: 0 0 10px; font-size: 10.5px; font-weight: 600;
    letter-spacing: 0.09em; text-transform: uppercase; color: var(--muted);
  }
  .indice ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
  .indice a { display: block; padding: 6px 10px; border-radius: 6px; font-size: 13px; color: var(--muted); text-decoration: none; }
  .indice a:hover { background: var(--surface); color: var(--ink); }
  @media (max-width: 900px) {
    .indice { position: static; }
    .indice ol { flex-direction: row; flex-wrap: wrap; gap: 6px; }
    .indice a { background: var(--surface); border: 1px solid var(--hairline); }
  }

  .fichas { display: flex; flex-direction: column; gap: 26px; min-width: 0; }

  .ficha {
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: 14px;
    overflow: hidden;
    scroll-margin-top: 84px;
  }
  .ficha > header { padding: 18px 22px 16px; border-bottom: 1px solid var(--hairline); }
  .ficha h3 { margin: 0 0 8px; font-size: 19px; font-weight: 700; letter-spacing: -0.015em; text-wrap: balance; }
  .ficha dl { margin: 0; }
  .dato { display: flex; gap: 8px; font-size: 13px; line-height: 1.7; }
  .dato dt {
    flex: 0 0 82px; color: var(--muted); font-size: 10.5px; font-weight: 600;
    letter-spacing: 0.07em; text-transform: uppercase; padding-top: 4px;
  }
  .dato dd { margin: 0; min-width: 0; }
  .dato dd.mono { font-family: var(--mono); font-size: 12.5px; color: var(--muted); }

  /* Los chips no decoran: dicen qué bloques ejercita cada plantilla, que es lo
     que hace que esto sea una galería y no la misma carta nueve veces. */
  .bloques { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 13px; }
  .bloques span {
    font: 500 11px/1 var(--mono);
    padding: 5px 9px; border-radius: 5px;
    background: var(--chip); color: var(--muted);
  }

  .marco { padding: 22px; background: var(--sunken); display: flex; justify-content: center; }
  .marco iframe {
    width: 700px; max-width: 100%; height: 940px; border: 0;
    background: #fff; border-radius: 6px;
    box-shadow: 0 1px 2px rgba(0,0,0,.16), 0 8px 24px rgba(0,0,0,.08);
    transition: width .18s ease;
  }
  @media (prefers-reduced-motion: reduce) { .marco iframe { transition: none; } }

  details { border-top: 1px solid var(--hairline); }
  summary { padding: 12px 22px; cursor: pointer; list-style: none; font-size: 12.5px; color: var(--muted); }
  summary::-webkit-details-marker { display: none; }
  summary::before { content: '▸ '; }
  details[open] summary::before { content: '▾ '; }
  summary:hover { color: var(--ink); }
  details pre {
    margin: 0; padding: 0 22px 18px;
    font-family: var(--mono); font-size: 12.5px; line-height: 1.75;
    white-space: pre-wrap; color: var(--muted);
    overflow-x: auto;
  }
  .pie-ficha {
    margin: 0; padding: 11px 22px; border-top: 1px solid var(--hairline);
    font-family: var(--mono); font-size: 11.5px; color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .aviso {
    margin: 0 0 22px; padding: 13px 16px;
    background: var(--surface); border: 1px solid var(--hairline);
    border-radius: 10px; font-size: 13px; color: var(--muted);
  }
  .aviso b { color: var(--ink); font-weight: 600; }
`;

// ── Contenido ──────────────────────────────────────────────────────────────
const fichas = listas
  .map((t) => {
    const bloques = bloquesDe(t.doc);
    const chips = bloques.map((b) => `<span>${esc(b.label)}</span>`).join('');
    return `
      <article class="ficha" id="${id(t.name)}">
        <header>
          <h3>${esc(t.name)}</h3>
          <dl>
            <div class="dato"><dt>Asunto</dt><dd>${esc(t.subject || '—')}</dd></div>
            <div class="dato"><dt>Bandeja</dt><dd class="mono">${esc(t.doc.settings.preheader || '—')}</dd></div>
          </dl>
          <div class="bloques">${chips}</div>
        </header>
        <div class="marco">
          <iframe title="Plantilla ${esc(t.name)}" loading="lazy" srcdoc="${esc(t.html)}"></iframe>
        </div>
        <details>
          <summary>Versión en texto plano — la que se lee sin HTML (${t.texto.length} caracteres)</summary>
          <pre>${esc(t.texto)}</pre>
        </details>
        <p class="pie-ficha">${t.html.length.toLocaleString('es')} bytes de HTML · ${bloques.length} tipos de bloque</p>
      </article>`;
  })
  .join('\n');

const indice = listas.map((t) => `<li><a href="#${id(t.name)}">${esc(t.name)}</a></li>`).join('\n        ');

const CONTENIDO = `<header class="barra">
  <div class="marca">
    <h1>Plantillas de fábrica del Email Marketing</h1>
    <p>${listas.length} plantillas · el mismo HTML que se envía, no una maqueta aparte</p>
  </div>
  <div class="conmutador">
    <span>Ancho</span>
    <div class="anchos">
      <button type="button" data-w="320">320</button>
      <button type="button" data-w="480">480</button>
      <button type="button" data-w="600">600</button>
      <button type="button" data-w="700" aria-pressed="true">Escritorio</button>
    </div>
  </div>
</header>

<div class="cuerpo">
  <nav class="indice" aria-label="Plantillas">
    <h2>Plantillas</h2>
    <ol>
        ${indice}
    </ol>
  </nav>

  <main class="fichas">
    <p class="aviso">
      Cada plantilla se ve <b>clara siempre</b>, aunque mires esta página en oscuro: así es como
      la recibe el cliente. A <b>620 px o menos las columnas se apilan</b> a propósito — es lo que
      hace la media query en el móvil de verdad. Los huecos de imagen salen vacíos porque
      <b>cada negocio sube la suya</b>.
    </p>
${fichas}
  </main>
</div>

<script>
  // El conmutador de ancho es el instrumento de esta página: reencuadra los
  // iframes y las media queries del correo se disparan igual que en un cliente.
  const botones = document.querySelectorAll('.anchos button');
  botones.forEach((btn) => {
    btn.addEventListener('click', () => {
      botones.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      document.querySelectorAll('.marco iframe').forEach((f) => {
        f.style.width = btn.dataset.w + 'px';
      });
    });
  });
</script>`;

const TITULO = 'Plantillas de fábrica del Email Marketing';

// Documento completo, para abrir en local.
const completo = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>${TITULO}</title>
${FUENTES}
<style>${ESTILOS}</style>
</head>
<body>
${CONTENIDO}
</body>
</html>
`;

// Fragmento para publicar: el publicador pone él <html>, <head> y <body>.
const fragmento = `<title>${TITULO}</title>
${FUENTES}
<style>${ESTILOS}</style>
${CONTENIDO}
`;

fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(SALIDA, completo, 'utf8');
console.log(`✓ ${listas.length} plantillas → ${path.relative(process.cwd(), SALIDA)} (${Math.round(completo.length / 1024)} KB)`);

if (SALIDA_ARTIFACT) {
  fs.mkdirSync(path.dirname(SALIDA_ARTIFACT), { recursive: true });
  fs.writeFileSync(SALIDA_ARTIFACT, fragmento, 'utf8');
  console.log(`✓ versión publicable → ${SALIDA_ARTIFACT} (${Math.round(fragmento.length / 1024)} KB)`);
}

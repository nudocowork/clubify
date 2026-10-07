#!/usr/bin/env node
/**
 * Migra las imágenes YA publicadas a la política por uso
 * (`src/media/politica-de-archivos.ts`): genera un derivado optimizado con
 * clave NUEVA, lo verifica y apunta las referencias de la base a él, guardando
 * la URL anterior para poder revertir. Nunca sobrescribe ni borra un original.
 *
 * La lógica vive en `src/media/migracion-de-imagenes.ts` (probada con dobles);
 * esto es solo la línea de comandos: de dónde salen las referencias, dónde se
 * escribe y el registro.
 *
 * MODOS (por defecto --simular: no escribe NADA ni en el bucket ni en la base)
 *
 *   --simular            Descarga, procesa y mide; los derivados van a una
 *                        carpeta temporal FUERA de OneDrive. Informe + página
 *                        HTML de comparación.
 *   --aplicar            Sube derivados y actualiza la base. Exige
 *                        --desde-la-base (o un inventario con tabla/columna/id)
 *                        y la tabla "ImagenMigrada"
 *                        (scripts/apply-imagen-migrada-migration.cjs).
 *   --revertir --lote X  Devuelve la URL anterior a las referencias del lote X
 *                        (solo donde todavía está la nueva).
 *
 * FUENTES
 *   --inventario <archivo.jsonl>   Una fila por referencia. Acepta los dos
 *                                  formatos del inventario: el público
 *                                  (`recursos.jsonl`: negocio, uso, url,
 *                                  bytes, formato, ancho, alto…) y el de la
 *                                  base (`urls-desde-la-base.jsonl`: tabla,
 *                                  columna, id, tenantId, url).
 *   --desde-la-base                Lee las columnas de `COLUMNAS` con
 *                                  DATABASE_PUBLIC_URL || DATABASE_URL.
 *   --estados <estado-negocios.json>  Prioridad por estado del negocio
 *                                  (activos primero) cuando no hay base.
 *
 * FILTROS Y RITMO
 *   --negocio a,b        Solo esos slugs.   --top N   Los N más pesados.
 *   --limite N           Máximo de recursos en esta corrida (lotes).
 *   --concurrencia N     Recursos a la vez (por defecto 3).
 *   --lote NOMBRE        Nombre del lote (por defecto la fecha). Reanuda: lo
 *                        ya terminado en <salida>/registro.jsonl se salta.
 *   --salida DIR         Carpeta de trabajo (por defecto %TEMP%/clubify-
 *                        optimizar-imagenes/<lote>). Se niega a usar OneDrive.
 *
 * EJEMPLOS
 *   node scripts/optimizar-imagenes-existentes.cjs --inventario C:/Users/USUARIO/clubify-inventario/recursos.jsonl --top 20
 *   railway run node scripts/optimizar-imagenes-existentes.cjs --desde-la-base --negocio konys --lote konys-1
 *   railway run node scripts/optimizar-imagenes-existentes.cjs --desde-la-base --aplicar --negocio konys --lote konys-1
 *   railway run node scripts/optimizar-imagenes-existentes.cjs --revertir --lote konys-1
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ── El núcleo TS: compilado (Railway) o vía ts-node (local) ────────────────
function cargarNucleo() {
  const compilado = path.join(__dirname, '..', 'dist', 'media', 'migracion-de-imagenes.js');
  if (fs.existsSync(compilado) && !process.env.MIGRACION_DESDE_SRC) {
    return { nucleo: require(compilado), politica: require(path.join(__dirname, '..', 'dist', 'media', 'politica-de-archivos.js')) };
  }
  require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs' } });
  return {
    nucleo: require('../src/media/migracion-de-imagenes'),
    politica: require('../src/media/politica-de-archivos'),
  };
}

function args(argv) {
  const a = { modo: 'simular', concurrencia: 3, negocios: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--simular') a.modo = 'simular';
    else if (k === '--aplicar') a.modo = 'aplicar';
    else if (k === '--revertir') a.modo = 'revertir';
    else if (k === '--inventario') a.inventario = v();
    else if (k === '--desde-la-base') a.base = true;
    else if (k === '--estados') a.estados = v();
    else if (k === '--negocio') a.negocios = new Set(v().split(',').map((s) => s.trim()).filter(Boolean));
    else if (k === '--top') a.top = Number(v());
    else if (k === '--limite') a.limite = Number(v());
    else if (k === '--concurrencia') a.concurrencia = Math.max(1, Math.min(8, Number(v()) || 3));
    else if (k === '--lote') a.lote = v();
    else if (k === '--salida') a.salida = v();
    else if (k === '--registro') a.registro = v();
    else if (k === '--ayuda' || k === '-h') a.ayuda = true;
    else throw new Error(`Opción desconocida: ${k}`);
  }
  a.lote = a.lote || `lote-${new Date().toISOString().slice(0, 10)}`;
  if (!/^[a-z0-9._-]{1,60}$/i.test(a.lote)) throw new Error('El nombre del lote solo admite letras, números, punto, guion y guion bajo.');
  return a;
}

const PRIORIDAD = { ACTIVE: 0, TRIAL: 1, SUSPENDED: 2 };

function leerJsonl(ruta) {
  return fs
    .readFileSync(ruta, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch {
        throw new Error(`${ruta}: la línea ${i + 1} no es JSON`);
      }
    });
}

/** Filas del inventario (cualquiera de los dos formatos) → referencias. */
function referenciasDelInventario(filas, nucleo, estados) {
  const refs = [];
  let ignoradas = 0;
  for (const f of filas) {
    if (!f || typeof f.url !== 'string' || !/^https?:\/\//i.test(f.url)) {
      ignoradas++;
      continue;
    }
    let uso;
    let tabla = null;
    let columna = null;
    let ruta = null;
    if (f.tabla && f.columna) {
      // Formato de la base: "coverConfig.bgImageUrl" = columna JSON + clave.
      const [col, ...resto] = String(f.columna).split('.');
      const c = nucleo.COLUMNAS.find((x) => x.tabla === f.tabla && x.columna === col && (x.ruta || null) === (resto.join('.') || null));
      if (!c) {
        ignoradas++;
        continue;
      }
      uso = c.uso;
      tabla = c.tabla;
      columna = c.columna;
      ruta = c.ruta || null;
    } else {
      uso = nucleo.usoDelInventario(f.uso);
      if (!uso) {
        ignoradas++;
        continue;
      }
    }
    const est = estados.get(f.negocio);
    refs.push({
      tenantId: f.tenantId || null,
      negocio: f.negocio || null,
      tabla,
      columna,
      ruta,
      id: f.id || null,
      uso,
      url: f.url,
      bytes: Number(f.bytes) || null,
      pesoServidoHoy: Number(f.pesoServidoHoy) || null,
      prioridadNegocio: f.filaBorrada ? 3 : (PRIORIDAD[est] ?? 1) + (f.visible === false ? 1 : 0),
    });
  }
  return { refs, ignoradas };
}

async function referenciasDeLaBase(prisma, nucleo) {
  const tenants = await prisma.$queryRawUnsafe(`SELECT id, slug, status::text AS status, "deletedAt" FROM "Tenant"`);
  const porId = new Map(tenants.map((t) => [t.id, t]));
  const refs = [];
  for (const c of nucleo.COLUMNAS) {
    const filas = await prisma.$queryRawUnsafe(c.sql);
    for (const f of filas) {
      if (!f.url || !/^https?:\/\//i.test(f.url)) continue;
      const t = porId.get(f.tenantId);
      refs.push({
        tenantId: f.tenantId,
        negocio: t?.slug ?? null,
        tabla: c.tabla,
        columna: c.columna,
        ruta: c.ruta || null,
        id: f.id,
        uso: c.uso,
        url: f.url,
        bytes: null,
        prioridadNegocio: !t || t.deletedAt ? 3 : PRIORIDAD[t.status] ?? 1,
      });
    }
  }
  return refs;
}

function salidaSegura(dir) {
  const abs = path.resolve(dir);
  if (/onedrive/i.test(abs)) {
    throw new Error(`La carpeta de trabajo no puede estar dentro de OneDrive (${abs}): se sincronizaría a la otra máquina.`);
  }
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

async function descargar(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`descarga ${r.status}`);
  const len = Number(r.headers.get('content-length') || 0);
  // 60 MB: el mayor original del inventario es un PDF de 36,5 MB.
  if (len > 60_000_000) throw new Error(`original de ${Math.round(len / 1e6)} MB: demasiado grande para procesar`);
  return Buffer.from(await r.arrayBuffer());
}

function s3Desde(env) {
  const { S3Client, PutObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY || !env.S3_PUBLIC_URL) {
    throw new Error('Faltan S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_PUBLIC_URL para --aplicar.');
  }
  const cliente = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION || 'auto',
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
  });
  const Bucket = env.S3_BUCKET || 'clubify-media';
  return {
    async existe(key) {
      try {
        const h = await cliente.send(new HeadObjectCommand({ Bucket, Key: key }));
        return Number(h.ContentLength ?? 0);
      } catch {
        return null;
      }
    },
    async subir(key, body, contentType) {
      await cliente.send(
        new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }),
      );
    },
    urlPublica: (key) => `${env.S3_PUBLIC_URL.replace(/\/$/, '')}/${key}`,
  };
}

function leerRegistro(ruta) {
  if (!fs.existsSync(ruta)) return [];
  return leerJsonl(ruta);
}

function resumen(entradas) {
  const porEstado = {};
  let antes = 0;
  let despues = 0;
  let pubAntes = 0;
  let pubDespues = 0;
  for (const e of entradas) {
    porEstado[e.estado] = (porEstado[e.estado] || 0) + 1;
    if ((e.estado === 'simulado' || e.estado === 'aplicado') && e.bytesAntes && e.bytesDespues) {
      antes += e.bytesAntes;
      despues += e.bytesDespues;
      if (e.publicoAntes && e.publicoDespues) {
        pubAntes += e.publicoAntes;
        pubDespues += e.publicoDespues;
      }
    }
  }
  return { porEstado, bytesAntes: antes, bytesDespues: despues, publicoAntes: pubAntes, publicoDespues: pubDespues };
}

const kb = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(2).replace('.', ',')} MB` : `${Math.round(n / 1e3)} KB`);

function paginaDeComparacion(entradas, dir) {
  const filas = entradas
    .filter((e) => e.estado === 'simulado' || e.estado === 'ya-optimo' || e.estado === 'revision-manual')
    .map((e) => {
      const nueva = e.estado === 'simulado' && e.urlNueva ? `file:///${e.urlNueva.replace(/\\/g, '/')}` : null;
      const mini = e.variantes && e.variantes['160'] ? `file:///${e.variantes['160'].replace(/\\/g, '/')}` : null;
      const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
      return `<section class="fila">
  <header><b>${esc(e.negocio)}</b> · ${esc(e.uso)} · <span class="estado ${esc(e.estado)}">${esc(e.estado)}</span>
  <span class="cifras">${kb(e.bytesAntes)} → ${kb(e.bytesDespues)}${e.bytesAntes && e.bytesDespues ? ` (−${Math.round((1 - e.bytesDespues / e.bytesAntes) * 100)} %)` : ''} · ${esc(e.formatoAntes)} → ${esc(e.formatoDespues)} · ${e.ancho ?? '?'}×${e.alto ?? '?'}${e.alfa ? ' · con transparencia' : ''}</span>
  ${e.motivo ? `<div class="motivo">${esc(e.motivo)}</div>` : ''}</header>
  <div class="par">
    <figure><figcaption>Original</figcaption><div class="damero"><img loading="lazy" src="${esc(e.urlAnterior)}"></div></figure>
    <figure><figcaption>Derivado</figcaption><div class="damero">${nueva ? `<img loading="lazy" src="${esc(nueva)}">` : '<p>sin derivado</p>'}</div>${mini ? `<img class="mini" src="${esc(mini)}" title="miniatura 160">` : ''}</figure>
  </div>
</section>`;
    })
    .join('\n');
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Comparación de imágenes</title>
<style>
:root{--bg:#fff;--ink:#0f172a;--mute:#64748b;--line:#e2e8f0;--brand:#22C55E;--bad:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#0b1220;--ink:#e2e8f0;--mute:#94a3b8;--line:#1e293b}}
body{margin:0;padding:16px;background:var(--bg);color:var(--ink);font:14px/1.45 Inter,system-ui,sans-serif}
h1{font-size:20px}.fila{border:1px solid var(--line);border-radius:12px;padding:12px;margin:0 0 16px}
.cifras{color:var(--mute);margin-left:6px}.motivo{color:var(--bad);font-size:12px;margin-top:4px}
.estado.simulado{color:var(--brand)}.par{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px}
@media (max-width:640px){.par{grid-template-columns:1fr}}
figure{margin:0}figcaption{font-size:12px;color:var(--mute);margin-bottom:4px}
.damero{background:conic-gradient(#ccc 25%,#fff 0 50%,#ccc 0 75%,#fff 0) 0 0/16px 16px;border-radius:8px;overflow:auto;max-height:70vh}
.damero img{display:block;max-width:none;width:100%;cursor:zoom-in}.damero img.zoom{width:auto}
.mini{margin-top:6px;border:1px solid var(--line)}
</style>
<h1>Comparación original / derivado</h1>
<p>Haz clic en una imagen para verla a tamaño real (para revisar textos y precios). El fondo de cuadros deja ver la transparencia.</p>
${filas}
<script>document.addEventListener('click',e=>{if(e.target.matches('.damero img'))e.target.classList.toggle('zoom')})</script>
</html>`;
  const ruta = path.join(dir, 'comparacion.html');
  fs.writeFileSync(ruta, html);
  return ruta;
}

(async () => {
  const a = args(process.argv.slice(2));
  if (a.ayuda) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
    return;
  }
  const { nucleo } = cargarNucleo();
  const dir = salidaSegura(a.salida || path.join(os.tmpdir(), 'clubify-optimizar-imagenes', a.lote));
  const rutaRegistro = a.registro || path.join(dir, 'registro.jsonl');
  const registroLocal = fs.createWriteStream(rutaRegistro, { flags: 'a' });
  console.log(`Modo: ${a.modo.toUpperCase()} · lote ${a.lote} · carpeta ${dir}`);

  let prisma = null;
  const necesitaBase = a.base || a.modo === 'aplicar' || a.modo === 'revertir';
  if (necesitaBase) {
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL } } });
  }
  const registrarEnBase = async (e) => {
    if (!prisma || e.modo === 'simular') return;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ImagenMigrada" ("clave","lote","modo","estado","tenantId","negocio","uso","urlAnterior","urlNueva","claveNueva","variantes","bytesAntes","bytesDespues","referencias","referenciasActualizadas","detalle","motivo")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16::jsonb,$17)`,
      e.clave, e.lote, e.modo, e.estado, e.tenantId, e.negocio, e.uso, e.urlAnterior, e.urlNueva, e.claveNueva,
      JSON.stringify(e.variantes || {}), e.bytesAntes, e.bytesDespues, e.referencias, e.referenciasActualizadas,
      JSON.stringify(e.detalle || []), e.motivo,
    );
  };
  const actualizar = async (ref, anterior, nueva) => {
    const sql = nucleo.sqlDeActualizacion(ref);
    if (!sql) throw new Error(`columna no migrable: ${ref.tabla}.${ref.columna}`);
    return prisma.$executeRawUnsafe(sql, ref.id, nueva, anterior);
  };

  try {
    // ── REVERTIR ────────────────────────────────────────────────────────────
    if (a.modo === 'revertir') {
      if (!a.lote) throw new Error('--revertir necesita --lote');
      const filas = await prisma.$queryRawUnsafe(
        `SELECT DISTINCT ON ("clave") * FROM "ImagenMigrada" WHERE "lote" = $1 AND "modo" = 'aplicar' ORDER BY "clave", "creadoEn" DESC`,
        a.lote,
      );
      console.log(`Revirtiendo ${filas.length} recurso(s) del lote ${a.lote}…`);
      const loteRev = `${a.lote}.revertido`;
      for (const f of filas) {
        const e = await nucleo.revertirEntrada(f, { actualizar, registrar: async () => undefined }, loteRev);
        registroLocal.write(JSON.stringify(e) + '\n');
        await registrarEnBase(e);
        console.log(`  ${e.estado.padEnd(10)} ${f.negocio} ${f.uso} (${e.referenciasActualizadas} ref.)`);
      }
      return;
    }

    // ── REFERENCIAS ─────────────────────────────────────────────────────────
    const estados = new Map();
    if (a.estados) {
      for (const n of JSON.parse(fs.readFileSync(a.estados, 'utf8'))) estados.set(n.slug, n.estadoBarrido || n.status);
    }
    let refs;
    if (a.base) refs = await referenciasDeLaBase(prisma, nucleo);
    else if (a.inventario) {
      const r = referenciasDelInventario(leerJsonl(a.inventario), nucleo, estados);
      refs = r.refs;
      console.log(`Inventario: ${refs.length} referencias usables, ${r.ignoradas} ignoradas (sin URL, miniaturas o columnas fuera de la migración).`);
    } else throw new Error('Indica --inventario <jsonl> o --desde-la-base.');
    if (a.negocios) refs = refs.filter((r) => a.negocios.has(r.negocio));

    let recursos = nucleo.agrupar(refs);
    if (a.top) recursos = [...recursos].sort((x, y) => y.bytes - x.bytes).slice(0, a.top);

    // Reanudación: lo terminado (en este lote y modo) no se repite.
    const previas = leerRegistro(rutaRegistro).filter((e) => e.lote === a.lote && e.modo === a.modo);
    const hechas = new Set(previas.filter((e) => nucleo.ESTADOS_FINALES.has(e.estado)).map((e) => e.clave));
    if (hechas.size) console.log(`Reanudando: ${hechas.size} recurso(s) ya terminados en este lote se saltan.`);
    let pendientes = recursos.filter((r) => !hechas.has(r.clave));
    if (a.limite) pendientes = pendientes.slice(0, a.limite);
    console.log(`${pendientes.length} recurso(s) por procesar (concurrencia ${a.concurrencia}).`);

    let deps;
    if (a.modo === 'aplicar') {
      const s3 = s3Desde(process.env);
      deps = { descargar, ...s3, actualizar, registrar: async () => undefined };
    } else {
      const dirDerivados = path.join(dir, 'derivados');
      fs.mkdirSync(dirDerivados, { recursive: true });
      deps = {
        descargar,
        existe: async () => null,
        subir: async () => {
          throw new Error('la simulación no sube nada');
        },
        urlPublica: (key) => `simulado://${key}`,
        actualizar: async () => {
          throw new Error('la simulación no escribe en la base');
        },
        registrar: async () => undefined,
        guardarLocal: async (nombre, body) => {
          const ruta = path.join(dirDerivados, nombre);
          fs.writeFileSync(ruta, body);
          return ruta;
        },
      };
    }

    let colaDeRegistro = Promise.resolve();
    const registrarConReintento = async (e) => {
      for (let intento = 1; intento <= 4; intento++) {
        try {
          return await registrarEnBase(e);
        } catch (err) {
          if (intento === 4) {
            console.error(`  (no se pudo registrar en la base tras 4 intentos: ${err.message}) — completa con registrar-migracion-desde-jsonl.cjs`);
            return;
          }
          await new Promise((ok) => setTimeout(ok, 1000 * intento));
        }
      }
    };
    const entradas = await nucleo.ejecutar(pendientes, deps, {
      modo: a.modo,
      lote: a.lote,
      concurrencia: a.concurrencia,
      alTerminar: (e, i, total) => {
        registroLocal.write(JSON.stringify(e) + '\n');
        // En FILA y con reintentos: lanzarlo sin esperar agotó las conexiones
        // en el lote prod-a1 (2026-10-07) y dejó filas sin registrar, que
        // `--revertir` no ve. Se espera la cola entera antes de salir.
        colaDeRegistro = colaDeRegistro.then(() => registrarConReintento(e));
        const ahorro = e.bytesAntes && e.bytesDespues ? ` ${kb(e.bytesAntes)} → ${kb(e.bytesDespues)}` : '';
        console.log(`  [${i}/${total}] ${e.estado.padEnd(15)} ${e.negocio ?? '?'} · ${e.uso}${ahorro}${e.motivo ? ` — ${e.motivo}` : ''}`);
      },
    });
    await colaDeRegistro;

    const todas = [...previas, ...entradas];
    const r = resumen(todas);
    fs.writeFileSync(path.join(dir, 'informe.json'), JSON.stringify({ lote: a.lote, modo: a.modo, ...r, entradas: todas }, null, 2));
    console.log('\nResumen:', JSON.stringify(r.porEstado));
    console.log(`Originales ${kb(r.bytesAntes)} → derivados ${kb(r.bytesDespues)}`);
    if (r.publicoAntes) console.log(`Lo que ve el cliente (estimado): ${kb(r.publicoAntes)} → ${kb(r.publicoDespues)}`);
    if (a.modo === 'simular') console.log(`Comparación visual: ${paginaDeComparacion(todas, dir)}`);
    console.log(`Registro: ${rutaRegistro}`);
  } finally {
    registroLocal.end();
    if (prisma) await prisma.$disconnect();
  }
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});

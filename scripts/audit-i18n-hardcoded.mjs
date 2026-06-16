#!/usr/bin/env node
/**
 * Extractor de literales hardcoded en español dentro de /admin/* y /app/*.
 *
 * Objetivo: descubrir el alcance real de strings a i18n-izar antes de
 * empezar el reemplazo masivo. Output: JSON estructurado + resumen
 * por categoría + ranking de archivos.
 *
 * Uso:
 *   node scripts/audit-i18n-hardcoded.mjs                # imprime resumen
 *   node scripts/audit-i18n-hardcoded.mjs --json         # imprime JSON crudo
 *   node scripts/audit-i18n-hardcoded.mjs --top 20       # top 20 archivos
 *   node scripts/audit-i18n-hardcoded.mjs --out FILE     # escribe a archivo
 *
 * Heurísticas de detección (los 3 disparan):
 *   1) Tiene acento/ñ: áéíóúüñ
 *   2) Match con palabras comunes (>=2 palabras): el, la, de, que, para,
 *      sin, con, más, guardar, cancelar, agregar, etc.
 *   3) 3+ palabras separadas por espacio, todas minúsculas/Capitalize.
 *
 * Filtros de skip:
 *   - URLs (http, https, mailto, tel)
 *   - Paths (/api/, ./, ../, /src/)
 *   - Solo Tailwind class names (kebab-case sin espacios humanos)
 *   - console.log/error/warn arguments
 *   - typeof/instanceof comparisons
 *   - Literales <= 2 caracteres
 *
 * Categorías:
 *   - jsx_text: texto dentro de elementos JSX (`<p>Hola</p>`)
 *   - placeholder: prop placeholder="..."
 *   - title/aria: title="...", aria-label="..."
 *   - alert/confirm: alert(), confirm(), toast()
 *   - error_message: throw new X('...'), new Error('...')
 *   - string_literal: cualquier otro string Spanish encontrado
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN_DIRS = [
  'frontend/src/app/admin',
  'frontend/src/app/app',
];

// Palabras comunes en español que activan la detección si aparecen 2+ veces.
const SPANISH_WORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'lo',
  'de', 'del', 'en', 'a', 'al', 'por', 'para', 'con', 'sin', 'desde',
  'hasta', 'sobre', 'bajo', 'entre',
  'que', 'quien', 'cual', 'donde', 'como', 'cuando', 'porque',
  'es', 'son', 'fue', 'fueron', 'sera', 'será', 'está', 'están', 'estaba',
  'tu', 'tus', 'mi', 'mis', 'su', 'sus', 'nuestro', 'nuestra',
  'este', 'esta', 'esto', 'estos', 'estas', 'ese', 'esa', 'eso',
  'no', 'sí', 'también', 'aún', 'todavía', 'ya', 'aquí', 'allí',
  // Verbos de acción comunes en UI
  'guardar', 'cancelar', 'agregar', 'añadir', 'editar', 'eliminar', 'borrar',
  'crear', 'modificar', 'enviar', 'recibir', 'descargar', 'subir',
  'configurar', 'activar', 'desactivar', 'habilitar', 'deshabilitar',
  'cerrar', 'abrir', 'continuar', 'volver', 'salir', 'entrar',
  // Sustantivos UI
  'nombre', 'apellido', 'correo', 'teléfono', 'dirección', 'ciudad',
  'país', 'estado', 'fecha', 'hora', 'precio', 'cantidad', 'monto',
  'usuario', 'cliente', 'negocio', 'producto', 'pedido', 'tarjeta',
  'cuenta', 'perfil', 'panel', 'pantalla', 'opción', 'campo',
  // Pequeñas frases
  'sí', 'no', 'aceptar', 'rechazar', 'ok', 'listo',
]);

// Palabras que indican mensaje informativo / error que es prioritario i18n-izar.
const HIGH_PRIORITY_HINTS = new Set([
  'error', 'éxito', 'exito', 'cargando', 'guardando', 'enviando',
  'falló', 'fallo', 'inválido', 'invalido', 'requerido', 'obligatorio',
  'confirmar', 'eliminar', 'borrar', 'cancelar',
  'bienvenido', 'gracias', 'felicitaciones',
]);

const ACCENTS_RE = /[áéíóúüñÁÉÍÓÚÜÑ]/;
const WORD_RE = /[\p{L}]+/gu;

function isProbablySpanish(text) {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 3) return false;

  // Skip pure URL/path/technical
  if (/^https?:\/\//.test(trimmed)) return false;
  if (/^(\/|\.\/|\.\.\/|~)/.test(trimmed)) return false;
  if (/^[a-z][a-zA-Z0-9_-]*$/.test(trimmed)) return false; // single identifier
  if (/^[A-Z_]+$/.test(trimmed) && !trimmed.includes(' ')) return false; // CONSTANT
  if (/^[a-z]+-[a-z-]+$/.test(trimmed)) return false; // tailwind class single
  if (/^[\d\s.,:/+\-]+$/.test(trimmed)) return false; // only digits/punct
  if (/^[\W_]+$/.test(trimmed)) return false; // only symbols

  // Has accent → very likely Spanish
  if (ACCENTS_RE.test(trimmed)) return true;

  // Word-based heuristic
  const words = (trimmed.toLowerCase().match(WORD_RE) || []);
  if (words.length < 2) {
    // Single word: only flag if it's a common Spanish action word
    return words.length === 1 && SPANISH_WORDS.has(words[0]);
  }
  let spanishHits = 0;
  for (const w of words) {
    if (SPANISH_WORDS.has(w)) spanishHits++;
  }
  if (spanishHits >= 2) return true;
  // 3+ words with at least one common Spanish word
  if (words.length >= 3 && spanishHits >= 1) return true;
  return false;
}

function priorityFor(text, category) {
  const lower = text.toLowerCase();
  for (const hint of HIGH_PRIORITY_HINTS) {
    if (lower.includes(hint)) return 'high';
  }
  if (category === 'alert' || category === 'confirm' || category === 'toast') {
    return 'high';
  }
  if (category === 'jsx_text' || category === 'placeholder') return 'medium';
  return 'low';
}

async function walk(dir, files = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.next') continue;
      await walk(full, files);
    } else if (ent.isFile() && /\.(tsx|ts)$/.test(ent.name)) {
      files.push(full);
    }
  }
  return files;
}

function extractFromFile(filePath, source) {
  const findings = [];
  const lines = source.split('\n');
  const hasI18nHook =
    /\buseTranslations\s*\(/.test(source) ||
    /\bgetTranslations\s*\(/.test(source);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ln = i + 1;

    // Skip comments
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    // 1) JSX text — heuristic: text between > and < not starting with {
    const jsxTextMatches = line.matchAll(/>([^<>{}\n]{3,}?)</g);
    for (const m of jsxTextMatches) {
      const txt = m[1].trim();
      if (!txt) continue;
      if (isProbablySpanish(txt)) {
        const category = 'jsx_text';
        findings.push({
          file: relative(REPO_ROOT, filePath),
          line: ln,
          column: m.index ?? 0,
          text: txt,
          category,
          priority: priorityFor(txt, category),
        });
      }
    }

    // 2) String literals — '...' or "..." or `...` (no interpolation in fence)
    const stringMatches = line.matchAll(
      /(?<!\w)(?:'([^'\n\\]{3,}?)'|"([^"\n\\]{3,}?)"|`([^`$\n\\]{3,}?)`)/g,
    );
    for (const m of stringMatches) {
      const txt = (m[1] ?? m[2] ?? m[3] ?? '').trim();
      if (!txt) continue;
      if (!isProbablySpanish(txt)) continue;

      // Categorize by surrounding context
      const before = line.slice(0, m.index ?? 0);
      let category = 'string_literal';
      if (/\bplaceholder\s*=\s*$/.test(before)) category = 'placeholder';
      else if (/\b(title|aria-label|alt)\s*=\s*$/.test(before)) category = 'aria_or_title';
      else if (/\balert\s*\(\s*$/.test(before)) category = 'alert';
      else if (/\bconfirm\s*\(\s*$/.test(before)) category = 'confirm';
      else if (/\btoast(?:\.[a-z]+)?\s*\(\s*$/.test(before)) category = 'toast';
      else if (/new\s+(?:Error|BadRequestException|NotFoundException|ForbiddenException)\s*\(\s*$/.test(before)) {
        category = 'error_message';
      }
      else if (/console\.(?:log|warn|error|info|debug)\s*\(\s*$/.test(before)) {
        // skip console logs — no son user-facing
        continue;
      }

      findings.push({
        file: relative(REPO_ROOT, filePath),
        line: ln,
        column: m.index ?? 0,
        text: txt,
        category,
        priority: priorityFor(txt, category),
        partial_i18n: hasI18nHook,
      });
    }
  }
  return findings;
}

function dedupeFindings(findings) {
  // Sometimes JSX text and string literal regex match the same span;
  // prefer JSX text version when (file, line, text) collide.
  const seen = new Map();
  for (const f of findings) {
    const key = `${f.file}::${f.line}::${f.text}`;
    const prev = seen.get(key);
    if (!prev || (prev.category === 'string_literal' && f.category === 'jsx_text')) {
      seen.set(key, f);
    }
  }
  return [...seen.values()];
}

function summarize(findings) {
  const byCategory = {};
  const byPriority = { high: 0, medium: 0, low: 0 };
  const byFile = new Map();
  for (const f of findings) {
    byCategory[f.category] = (byCategory[f.category] || 0) + 1;
    byPriority[f.priority] = (byPriority[f.priority] || 0) + 1;
    byFile.set(f.file, (byFile.get(f.file) || 0) + 1);
  }
  const topFiles = [...byFile.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([file, count]) => ({ file, count }));
  return {
    total: findings.length,
    byCategory,
    byPriority,
    topFiles,
    filesScanned: new Set(findings.map((f) => f.file)).size,
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const wantJson = argv.includes('--json');
  const topIdx = argv.indexOf('--top');
  const topN = topIdx >= 0 ? Number(argv[topIdx + 1]) || 20 : 20;
  const outIdx = argv.indexOf('--out');
  const outFile = outIdx >= 0 ? argv[outIdx + 1] : null;

  const allFiles = [];
  for (const dir of SCAN_DIRS) {
    await walk(join(REPO_ROOT, dir), allFiles);
  }

  const findings = [];
  for (const f of allFiles) {
    const src = await readFile(f, 'utf8');
    findings.push(...extractFromFile(f, src));
  }
  const deduped = dedupeFindings(findings);
  const summary = summarize(deduped);

  if (outFile) {
    await writeFile(outFile, JSON.stringify({ summary, findings: deduped }, null, 2));
    console.log(`Wrote ${outFile} (${deduped.length} findings)`);
  }

  if (wantJson) {
    console.log(JSON.stringify({ summary, findings: deduped }, null, 2));
    return;
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log('  AUDITORÍA i18n — STRINGS HARDCODED EN ESPAÑOL');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log(`Archivos escaneados:  ${allFiles.length}`);
  console.log(`Archivos con hits:    ${summary.filesScanned}`);
  console.log(`Total hits:           ${summary.total}`);
  console.log('');
  console.log('Por prioridad:');
  for (const [p, n] of Object.entries(summary.byPriority)) {
    console.log(`  ${p.padEnd(8)}: ${n}`);
  }
  console.log('');
  console.log('Por categoría:');
  for (const [c, n] of Object.entries(summary.byCategory).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${c.padEnd(18)}: ${n}`);
  }
  console.log('');
  console.log(`Top ${topN} archivos:`);
  for (const { file, count } of summary.topFiles.slice(0, topN)) {
    console.log(`  ${String(count).padStart(4)}  ${file}`);
  }
  console.log('');
  console.log('Para JSON completo:  node scripts/audit-i18n-hardcoded.mjs --json');
  console.log('Para volcar a file:  node scripts/audit-i18n-hardcoded.mjs --out audit.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

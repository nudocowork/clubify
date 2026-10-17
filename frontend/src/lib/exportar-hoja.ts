/**
 * Descargar una tabla como CSV o como Excel (.xlsx) desde el navegador.
 *
 * Por qué un .xlsx hecho a mano y no una librería: el panel no tenía ninguna
 * de hojas de cálculo, la máquina de desarrollo tiene poca memoria para
 * instalar y compilar SheetJS, y lo que se necesita es mínimo (texto y
 * números en varias hojas). Un .xlsx es un ZIP con unos XML: se arma sin
 * comprimir (método «store»), que Excel, Google Sheets y Numbers abren igual.
 * NO es un CSV renombrado: ese abre con la advertencia de «formato no
 * coincide» y rompe tildes y decimales.
 */

export type Celda = string | number | null | undefined;
export type Hoja = { nombre: string; filas: Celda[][] };

// ── CSV ─────────────────────────────────────────────────────────────────────

/** CSV con «;» y BOM: Excel en español abre así las columnas y las tildes. */
export function aCsv(filas: Celda[][]): string {
  const celda = (v: Celda) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${filas.map((f) => f.map(celda).join(';')).join('\r\n')}`;
}

export function descargarCsv(nombreArchivo: string, filas: Celda[][]) {
  descargar(new Blob([aCsv(filas)], { type: 'text/csv;charset=utf-8' }), nombreArchivo);
}

// ── XLSX ────────────────────────────────────────────────────────────────────

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Caracteres de control no permitidos en XML 1.0.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function columna(i: number) {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function hojaXml(filas: Celda[][]): string {
  const cuerpo = filas
    .map((fila, i) => {
      const celdas = fila
        .map((v, j) => {
          const ref = `${columna(j)}${i + 1}`;
          if (v === null || v === undefined || v === '') return '';
          // La primera fila es cabecera: va en negrita (estilo 1).
          const estilo = i === 0 ? ' s="1"' : typeof v === 'number' ? ' s="2"' : '';
          if (typeof v === 'number' && Number.isFinite(v)) {
            return `<c r="${ref}"${estilo}><v>${v}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"${estilo}><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
        })
        .join('');
      return `<row r="${i + 1}">${celdas}</row>`;
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${cuerpo}</sheetData></worksheet>`
  );
}

export function aXlsx(hojas: Hoja[]): Uint8Array {
  // Nombres de hoja: máx. 31 caracteres y sin []:*?/\ (regla de Excel).
  const nombres = hojas.map((h, i) =>
    (h.nombre || `Hoja ${i + 1}`).replace(/[[\]:*?/\\]/g, ' ').slice(0, 31),
  );
  const archivos: Array<[string, string]> = [
    [
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        hojas
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join('') +
        '</Types>',
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    ],
    [
      'xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        nombres.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>',
    ],
    [
      'xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        hojas
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('') +
        `<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>',
    ],
    [
      'xl/styles.xml',
      // 0 = normal · 1 = negrita (cabecera) · 2 = número con 2 decimales.
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="3">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
        '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
        '</cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        '</styleSheet>',
    ],
    ...hojas.map((h, i) => [`xl/worksheets/sheet${i + 1}.xml`, hojaXml(h.filas)] as [string, string]),
  ];
  return zipSinComprimir(archivos.map(([n, c]) => [n, new TextEncoder().encode(c)]));
}

export function descargarXlsx(nombreArchivo: string, hojas: Hoja[]) {
  const bytes = aXlsx(hojas);
  descargar(
    new Blob([bytes as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    nombreArchivo,
  );
}

// ── ZIP (store) ─────────────────────────────────────────────────────────────

let TABLA_CRC: Uint32Array | null = null;
function crc32(datos: Uint8Array): number {
  if (!TABLA_CRC) {
    TABLA_CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLA_CRC[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < datos.length; i++) crc = TABLA_CRC[(crc ^ datos[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipSinComprimir(archivos: Array<[string, Uint8Array]>): Uint8Array {
  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [nombre, datos] of archivos) {
    const n = new TextEncoder().encode(nombre);
    const crc = crc32(datos);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nombres en UTF-8
    local.setUint16(8, 0, true); // store
    local.setUint32(14, crc, true);
    local.setUint32(18, datos.length, true);
    local.setUint32(22, datos.length, true);
    local.setUint16(26, n.length, true);
    partes.push(new Uint8Array(local.buffer), n, datos);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, datos.length, true);
    c.setUint32(24, datos.length, true);
    c.setUint16(28, n.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), n);
    offset += 30 + n.length + datos.length;
  }
  const tamCentral = central.reduce((s, b) => s + b.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, archivos.length, true);
  fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true);
  fin.setUint32(16, offset, true);
  const todo = [...partes, ...central, new Uint8Array(fin.buffer)];
  const out = new Uint8Array(todo.reduce((s, b) => s + b.length, 0));
  let p = 0;
  for (const b of todo) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}

function descargar(blob: Blob, nombreArchivo: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombreArchivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from './Toast';

type ParsedRow = Record<string, string>;
type Result = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

const REQUIRED_FIELD = 'fullName';
const KNOWN_FIELDS = ['fullName', 'email', 'phone', 'birthday', 'tags'];
const FIELD_LABEL: Record<string, string> = {
  fullName: 'Nombre completo *',
  email: 'Email',
  phone: 'Teléfono',
  birthday: 'Cumpleaños (YYYY-MM-DD)',
  tags: 'Tags (separados por ,)',
  '': '— Ignorar —',
};

/** Parser CSV minimalista que respeta comillas dobles. */
function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  function splitLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else {
        if (ch === ',') {
          out.push(cur);
          cur = '';
        } else if (ch === '"') {
          inQuotes = true;
        } else {
          cur += ch;
        }
      }
    }
    out.push(cur);
    return out;
  }

  const headers = splitLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map(splitLine);
  return { headers, rows };
}

function autoMap(header: string): string {
  const h = header.toLowerCase().trim();
  if (/(name|nombre)/.test(h)) return 'fullName';
  if (/(email|correo)/.test(h)) return 'email';
  if (/(phone|tel|whats)/.test(h)) return 'phone';
  if (/(birth|cumple|nacim)/.test(h)) return 'birthday';
  if (/(tag|etiqueta|categor)/.test(h)) return 'tags';
  return '';
}

export function CSVImporter({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const { headers, rows } = parseCSV(text);
      setHeaders(headers);
      setRows(rows);
      setMapping(headers.map(autoMap));
      setResult(null);
    };
    reader.readAsText(file, 'utf-8');
  }

  async function runImport() {
    if (!mapping.includes(REQUIRED_FIELD)) {
      toast('Marca alguna columna como "Nombre completo"', 'error');
      return;
    }
    setImporting(true);
    try {
      const parsed: ParsedRow[] = rows.map((row) => {
        const obj: ParsedRow = {};
        mapping.forEach((field, idx) => {
          if (field) obj[field] = row[idx] ?? '';
        });
        return obj;
      });
      const r = await api<Result>('/customers/import', {
        method: 'POST',
        body: JSON.stringify({ rows: parsed }),
      });
      setResult(r);
      toast(
        `${r.created + r.updated} clientes importados (${r.created} nuevos)`,
        'success',
      );
      onDone();
    } catch (e: any) {
      toast(e.message || 'Error importando', 'error');
    } finally {
      setImporting(false);
    }
  }

  function downloadTemplate() {
    const csv =
      'Nombre,Email,Teléfono,Cumpleaños,Tags\n' +
      'Juan Pérez,juan@ejemplo.com,+57 300 1234567,1990-05-21,VIP\n';
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla-clientes.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/60" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-line2 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-lg">Importar clientes desde CSV</h2>
            <p className="text-xs text-mute mt-0.5">
              Sube tu CSV exportado de Excel/Sheets/Mercadolibre. Si un cliente
              ya existe (mismo teléfono o email), se actualiza en vez de
              duplicarse.
            </p>
          </div>
          <button onClick={onClose} className="text-mute hover:text-ink text-lg">
            ✕
          </button>
        </div>

        <div className="px-6 py-4 overflow-auto flex-1">
          {result ? (
            <div className="text-center py-6">
              <div className="text-4xl mb-2">✅</div>
              <div className="font-semibold text-lg">¡Importación lista!</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 text-sm">
                <Stat label="Total" value={result.total} />
                <Stat label="Nuevos" value={result.created} accent="ok" />
                <Stat label="Actualizados" value={result.updated} accent="brand" />
                <Stat label="Saltados" value={result.skipped} accent="amber" />
              </div>
              {result.errors.length > 0 && (
                <div className="mt-4 text-left rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs">
                  <div className="font-semibold text-amber-900 mb-1">
                    Algunos errores:
                  </div>
                  <ul className="space-y-0.5 text-amber-800">
                    {result.errors.map((e, i) => (
                      <li key={i}>• {e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : headers.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-2">📥</div>
              <div className="font-semibold text-sm">
                Sube tu archivo .csv
              </div>
              <p className="text-xs text-mute mt-1.5 max-w-md mx-auto">
                Las columnas obligatorias son: <b>Nombre</b>. Email/Teléfono
                ayudan a no duplicar clientes existentes.
              </p>
              <label className="btn-primary mt-4 inline-flex cursor-pointer">
                Seleccionar archivo
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={onFile}
                />
              </label>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="text-xs text-brand hover:underline"
                >
                  ⤓ Descargar plantilla de ejemplo
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="text-xs text-mute mb-2">
                {rows.length} fila{rows.length === 1 ? '' : 's'} detectada
                {rows.length === 1 ? '' : 's'}. Mapea cada columna del CSV al
                campo correspondiente:
              </div>
              <div className="space-y-1.5 mb-4">
                {headers.map((h, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 text-sm bg-bg2/50 rounded-lg px-3 py-2"
                  >
                    <code className="text-xs flex-1 truncate min-w-0">
                      {h || '(sin nombre)'}
                    </code>
                    <span className="text-mute text-xs">→</span>
                    <select
                      value={mapping[idx] ?? ''}
                      onChange={(e) => {
                        const next = [...mapping];
                        next[idx] = e.target.value;
                        setMapping(next);
                      }}
                      className="input text-xs py-1 max-w-[220px]"
                    >
                      <option value="">— Ignorar —</option>
                      {KNOWN_FIELDS.map((f) => (
                        <option key={f} value={f}>
                          {FIELD_LABEL[f]}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              {/* Preview primeras 3 filas */}
              <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1.5">
                Vista previa (primeras 3 filas)
              </div>
              <div className="overflow-x-auto rounded-lg border border-line2">
                <table className="w-full text-xs">
                  <thead className="bg-bg2">
                    <tr>
                      {headers.map((h, i) => (
                        <th
                          key={i}
                          className="px-2 py-1.5 text-left font-semibold text-mute"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 3).map((r, i) => (
                      <tr key={i} className="border-t border-line2">
                        {r.map((v, j) => (
                          <td key={j} className="px-2 py-1.5 truncate max-w-[180px]">
                            {v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-3 border-t border-line2 bg-bg2/40 flex items-center justify-end gap-2">
          <button onClick={onClose} className="btn-ghost text-sm">
            {result ? 'Cerrar' : 'Cancelar'}
          </button>
          {!result && headers.length > 0 && (
            <button
              onClick={runImport}
              disabled={importing}
              className="btn-primary disabled:opacity-50"
            >
              {importing ? 'Importando…' : `Importar ${rows.length} fila${rows.length === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'brand' | 'ok' | 'amber';
}) {
  const cls: Record<string, string> = {
    brand: 'text-brand',
    ok: 'text-ok',
    amber: 'text-amber-700',
  };
  return (
    <div className="card p-3">
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
        {label}
      </div>
      <div className={`text-lg font-bold mt-0.5 ${accent ? cls[accent] : ''}`}>
        {value}
      </div>
    </div>
  );
}

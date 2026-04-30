/**
 * Pequeño serializador CSV. Sin dependencia npm.
 * Maneja escape de comillas, comas y saltos de línea según RFC 4180.
 */
export function toCSV<T extends Record<string, any>>(
  rows: T[],
  columns: { key: keyof T | string; label: string; format?: (v: any, row: T) => any }[],
): string {
  const escape = (v: any) => {
    if (v == null) return '';
    let s = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
      s = '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const header = columns.map((c) => escape(c.label)).join(',');
  const body = rows
    .map((r) =>
      columns
        .map((c) => {
          const raw = (r as any)[c.key];
          const v = c.format ? c.format(raw, r) : raw;
          return escape(v);
        })
        .join(','),
    )
    .join('\n');
  return '﻿' + header + '\n' + body; // BOM para que Excel detecte UTF-8
}

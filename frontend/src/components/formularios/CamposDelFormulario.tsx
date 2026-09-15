'use client';

/**
 * Pinta las preguntas de un formulario del equipo y recoge las respuestas.
 *
 * Lo usan la vista previa del constructor («Formularios») y la agenda pública
 * (`/agenda/<slug>`). Es `FormRenderer` de TeamClubify con los tipos que
 * Clubify PRO admite. Agrupa por sección, respeta las preguntas condicionales
 * (en cascada) y marca las obligatorias que faltan.
 */

import {
  camposVisibles,
  type CampoDeFormulario,
  type Respuestas,
} from '@/lib/formularios';

export function CamposDelFormulario({
  campos,
  respuestas,
  onCambio,
  errores,
}: {
  campos: CampoDeFormulario[];
  respuestas: Respuestas;
  onCambio: (clave: string, valor: string | string[] | boolean | null) => void;
  errores?: Set<string>;
}) {
  const visibles = camposVisibles(campos, respuestas);

  // Secciones seguidas: una pregunta sin sección se queda en la anterior.
  const secciones: { titulo: string | null; campos: CampoDeFormulario[] }[] = [];
  for (const c of visibles) {
    const titulo = c.section?.trim() || null;
    const ultima = secciones[secciones.length - 1];
    if (ultima && (titulo === null || titulo === ultima.titulo)) ultima.campos.push(c);
    else secciones.push({ titulo, campos: [c] });
  }

  return (
    <div className="flex flex-col gap-5">
      {secciones.map((s, i) => (
        <fieldset key={`${s.titulo ?? 'sin'}-${i}`} className="m-0 flex flex-col gap-3 border-0 p-0">
          {s.titulo && <legend className="mb-1 p-0 text-sm font-semibold text-ink">{s.titulo}</legend>}
          {s.campos.map((c) => (
            <Pregunta
              key={c.id}
              campo={c}
              valor={respuestas[c.key]}
              error={!!errores?.has(c.key)}
              onCambio={(v) => onCambio(c.key, v)}
            />
          ))}
        </fieldset>
      ))}
    </div>
  );
}

function Pregunta({
  campo,
  valor,
  error,
  onCambio,
}: {
  campo: CampoDeFormulario;
  valor: string | string[] | boolean | null | undefined;
  error: boolean;
  onCambio: (v: string | string[] | boolean | null) => void;
}) {
  const texto = typeof valor === 'string' ? valor : '';
  const id = `campo-${campo.id}`;

  const etiqueta = (
    <label htmlFor={id} className="label">
      {campo.label}
      {campo.required && <span className="ml-0.5 text-bad-ink">*</span>}
    </label>
  );
  const ayuda = campo.help ? <p className="m-0 mt-0.5 text-xs text-mute">{campo.help}</p> : null;
  const aviso = error ? <p className="m-0 mt-0.5 text-xs text-bad-ink">Falta o no es válida.</p> : null;

  let control: React.ReactNode;
  switch (campo.type) {
    case 'long_text':
      control = (
        <textarea
          id={id}
          rows={3}
          maxLength={4000}
          value={texto}
          placeholder={campo.placeholder}
          onChange={(e) => onCambio(e.target.value)}
          className="input resize-y"
        />
      );
      break;
    case 'select':
      control = (
        <select id={id} value={texto} onChange={(e) => onCambio(e.target.value || null)} className="input">
          <option value="">Elige…</option>
          {(campo.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case 'radio':
      control = (
        <div id={id} role="radiogroup" className="flex flex-col gap-1.5">
          {(campo.options ?? []).map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name={id}
                checked={texto === o.value}
                onChange={() => onCambio(o.value)}
                className="accent-brand"
              />
              {o.label}
            </label>
          ))}
        </div>
      );
      break;
    case 'multiselect': {
      const elegidas = Array.isArray(valor) ? valor : [];
      control = (
        <div id={id} className="flex flex-col gap-1.5">
          {(campo.options ?? []).map((o) => (
            <label key={o.value} className="flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={elegidas.includes(o.value)}
                onChange={(e) =>
                  onCambio(e.target.checked ? [...elegidas, o.value] : elegidas.filter((x) => x !== o.value))
                }
                className="accent-brand"
              />
              {o.label}
            </label>
          ))}
        </div>
      );
      break;
    }
    case 'checkbox':
      // La casilla lleva su texto al lado: no se repite la etiqueta arriba.
      return (
        <div>
          <label className="flex cursor-pointer items-start gap-2 text-sm text-ink">
            <input
              id={id}
              type="checkbox"
              checked={valor === true}
              onChange={(e) => onCambio(e.target.checked)}
              className="mt-0.5 accent-brand"
            />
            <span>
              {campo.label}
              {campo.required && <span className="ml-0.5 text-bad-ink">*</span>}
            </span>
          </label>
          {ayuda}
          {aviso}
        </div>
      );
    default: {
      const tipo =
        campo.type === 'number'
          ? 'number'
          : campo.type === 'email'
            ? 'email'
            : campo.type === 'whatsapp'
              ? 'tel'
              : campo.type === 'url'
                ? 'url'
                : campo.type === 'date'
                  ? 'date'
                  : campo.type === 'time'
                    ? 'time'
                    : 'text';
      control = (
        <input
          id={id}
          type={tipo}
          inputMode={campo.type === 'whatsapp' ? 'tel' : undefined}
          value={texto}
          maxLength={500}
          placeholder={campo.placeholder ?? (campo.type === 'instagram' ? '@tunegocio' : undefined)}
          onChange={(e) => onCambio(e.target.value)}
          className="input"
        />
      );
    }
  }

  return (
    <div>
      {etiqueta}
      {control}
      {ayuda}
      {aviso}
    </div>
  );
}

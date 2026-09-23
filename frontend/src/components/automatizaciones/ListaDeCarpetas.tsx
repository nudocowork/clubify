'use client';

/**
 * Columna izquierda de «Mensajes automáticos»: buscador, carpetas y los
 * destinos de prueba.
 *
 * Los dos campos de prueba (número y correo) estaban arriba del todo, ocupando
 * un bloque amarillo del ancho de la pantalla, cuando se tocan una vez cada
 * varios meses. Aquí bajan al pie en letra pequeña —como un dato, que es lo que
 * son— y solo se abren si pulsas «cambiar».
 *
 * Colores por tokens: bajo `.brand-panel` la marca pinta `bg-brand-soft` y
 * `text-brand` con el suyo sin tocar este archivo.
 */

import { useState } from 'react';
import type { BrandMsgFolder } from './tipos';

type Props = {
  carpetas: BrandMsgFolder[];
  /** Mensajes por carpeta YA filtrados por la búsqueda. */
  conteos: Record<string, number>;
  /** Total de mensajes que pasan el filtro, para la fila «Todas». */
  totalFiltrado: number;
  busqueda: string;
  onBuscar: (v: string) => void;
  /** `null` = todas las carpetas (solo aparece mientras hay búsqueda). */
  carpetaActiva: string | null;
  onElegirCarpeta: (id: string | null) => void;
  telefono: string;
  onTelefono: (v: string) => void;
  onGuardarTelefono: () => void;
  correo: string;
  onCorreo: (v: string) => void;
  onGuardarCorreo: () => void;
  guardando: boolean;
  growConnected: boolean;
  emailConnected: boolean;
};

export default function ListaDeCarpetas({
  carpetas,
  conteos,
  totalFiltrado,
  busqueda,
  onBuscar,
  carpetaActiva,
  onElegirCarpeta,
  telefono,
  onTelefono,
  onGuardarTelefono,
  correo,
  onCorreo,
  onGuardarCorreo,
  guardando,
  growConnected,
  emailConnected,
}: Props) {
  const [editandoPruebas, setEditandoPruebas] = useState(false);
  const enBusqueda = busqueda.trim().length > 0;

  return (
    <aside className="w-full min-[900px]:w-[270px] min-[900px]:shrink-0 flex flex-col gap-3">
      <div>
        <label htmlFor="buscar-mensaje" className="sr-only">
          Buscar mensaje
        </label>
        <input
          id="buscar-mensaje"
          type="search"
          value={busqueda}
          onChange={(e) => onBuscar(e.target.value)}
          placeholder="Buscar mensaje…"
          className="input min-h-[44px] text-sm"
        />
      </div>

      <nav
        aria-label="Carpetas de mensajes"
        className="flex gap-1.5 overflow-x-auto pb-1 min-[900px]:flex-col min-[900px]:overflow-visible min-[900px]:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {enBusqueda && (
          // «Todas» solo existe buscando: sin búsqueda no aporta nada y una
          // carpeta siempre está elegida.
          <BotonDeCarpeta
            nombre="Todas las carpetas"
            cuantos={totalFiltrado}
            activa={carpetaActiva === null}
            onClick={() => onElegirCarpeta(null)}
          />
        )}
        {carpetas.map((f) => (
          <BotonDeCarpeta
            key={f.id}
            nombre={f.name}
            cuantos={conteos[f.id] ?? 0}
            activa={carpetaActiva === f.id}
            onClick={() => onElegirCarpeta(f.id)}
          />
        ))}
      </nav>

      <div className="border-t border-line2 pt-3 text-[11px] leading-relaxed text-mute">
        {!editandoPruebas ? (
          <>
            <p className="m-0">
              Las pruebas se envían a{' '}
              <b className="text-ink">{telefono.trim() || 'ningún número'}</b> y a{' '}
              <b className="text-ink break-all">
                {correo.trim() || 'ningún correo'}
              </b>
              .
            </p>
            <button
              type="button"
              onClick={() => setEditandoPruebas(true)}
              className="mt-0.5 min-h-[44px] inline-flex items-center font-semibold text-brand underline underline-offset-2"
            >
              Cambiar destinos de prueba
            </button>
          </>
        ) : (
          <div className="flex flex-col gap-2.5">
            <div>
              <label
                htmlFor="telefono-de-prueba"
                className="block font-semibold text-ink"
              >
                Número de prueba
              </label>
              <div className="mt-1 flex gap-1.5">
                <input
                  id="telefono-de-prueba"
                  value={telefono}
                  onChange={(e) => onTelefono(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onGuardarTelefono();
                  }}
                  placeholder="+57 300 123 4567"
                  className="input min-h-[44px] flex-1 text-xs"
                />
                <button
                  type="button"
                  onClick={onGuardarTelefono}
                  disabled={guardando}
                  className="min-h-[44px] shrink-0 rounded-input border border-line bg-white px-3 text-xs font-semibold text-ink hover:bg-bg2 disabled:opacity-50"
                >
                  Guardar
                </button>
              </div>
            </div>
            <div>
              <label
                htmlFor="correo-de-prueba"
                className="block font-semibold text-ink"
              >
                Correo de prueba
              </label>
              <div className="mt-1 flex gap-1.5">
                <input
                  id="correo-de-prueba"
                  type="email"
                  value={correo}
                  onChange={(e) => onCorreo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onGuardarCorreo();
                  }}
                  placeholder="tu@correo.com"
                  className="input min-h-[44px] flex-1 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={onGuardarCorreo}
                  disabled={guardando}
                  className="min-h-[44px] shrink-0 rounded-input border border-line bg-white px-3 text-xs font-semibold text-ink hover:bg-bg2 disabled:opacity-50"
                >
                  Guardar
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setEditandoPruebas(false)}
              className="min-h-[44px] self-start font-semibold text-brand underline underline-offset-2"
            >
              Listo
            </button>
          </div>
        )}

        {!growConnected && (
          <p className="mt-2 m-0 text-warn-ink">
            ⚠ Esta marca aún no tiene subcuenta de mensajería conectada; la
            prueba de WhatsApp no se enviará hasta conectarla.
          </p>
        )}
        {!emailConnected && (
          <p className="mt-2 m-0 text-warn-ink">
            ⚠ Esta marca todavía no tiene remitente propio de correo; sus
            correos no salen. Configúralo en Master Admin → Marcas.
          </p>
        )}
      </div>
    </aside>
  );
}

function BotonDeCarpeta({
  nombre,
  cuantos,
  activa,
  onClick,
}: {
  nombre: string;
  cuantos: number;
  activa: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={activa ? 'true' : undefined}
      className={`min-h-[44px] shrink-0 min-[900px]:shrink flex items-center justify-between gap-2 rounded-input px-3 py-2 text-left text-[13px] transition ${
        activa
          ? 'bg-brand-soft font-semibold text-ink'
          : 'font-medium text-mute hover:bg-bg2'
      }`}
    >
      <span className="truncate">{nombre}</span>
      <span
        className={`shrink-0 text-[11px] tabular-nums ${activa ? 'text-brand' : 'text-mute2'}`}
      >
        {cuantos}
      </span>
    </button>
  );
}

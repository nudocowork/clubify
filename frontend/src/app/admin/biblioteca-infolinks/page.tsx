'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

/**
 * /admin/biblioteca-infolinks — «Biblioteca de Infolinks» (Javier, 2026-10-25).
 *
 * Cada negocio de la marca con su logo y los enlaces de sus InfoLinks, para
 * copiarlos o abrirlos sin entrar al panel de cada uno. Los enlaces los arma
 * el backend con el dominio de la marca del negocio: aquí no se adivina nada.
 */
type Infolink = { id: string; titulo: string; url: string; activo: boolean; visitas: number };
type Negocio = {
  id: string;
  nombre: string;
  slug: string;
  logoUrl: string | null;
  estado: string;
  urlLista: string;
  activos: number;
  infolinks: Infolink[];
};
type Vista = 'cuadricula' | 'lista';

const sinTildes = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** «https://soyclubify.com/cabecera» → «soyclubify.com/cabecera». */
const corto = (url: string) => url.replace(/^https?:\/\//, '');

const iniciales = (nombre: string) =>
  nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

async function copiar(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast('Enlace copiado', 'success');
  } catch {
    toast('No se pudo copiar. Selecciónalo y cópialo a mano.', 'error');
  }
}

export default function BibliotecaInfolinksPage() {
  const [negocios, setNegocios] = useState<Negocio[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [soloActivos, setSoloActivos] = useState(true);
  const [vista, setVista] = useState<Vista>('cuadricula');

  useEffect(() => {
    try {
      const v = localStorage.getItem('biblioteca-infolinks:vista');
      if (v === 'lista' || v === 'cuadricula') setVista(v);
    } catch {}
    api<Negocio[]>('/admin/biblioteca-infolinks')
      .then(setNegocios)
      .catch((e: any) => setError(e?.message || 'No se pudo cargar la biblioteca'));
  }, []);

  const cambiarVista = (v: Vista) => {
    setVista(v);
    try {
      localStorage.setItem('biblioteca-infolinks:vista', v);
    } catch {}
  };

  const visibles = useMemo(() => {
    const q = sinTildes(busqueda.trim());
    return (negocios ?? [])
      .map((n) => ({ ...n, infolinks: soloActivos ? n.infolinks.filter((i) => i.activo) : n.infolinks }))
      .filter((n) => n.infolinks.length > 0)
      .filter(
        (n) =>
          !q ||
          sinTildes(n.nombre).includes(q) ||
          n.slug.includes(q) ||
          n.infolinks.some((i) => sinTildes(i.titulo).includes(q) || i.url.includes(q)),
      );
  }, [negocios, busqueda, soloActivos]);

  const totalEnlaces = visibles.reduce((s, n) => s + n.infolinks.length, 0);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="text-2xl font-bold">Biblioteca de Infolinks</h1>
          <p className="text-sm text-mute mt-1 max-w-2xl">
            Los InfoLinks de cada negocio, con su logo y sus enlaces listos para copiar o abrir.
          </p>
        </div>
      </div>

      <div className="card card-pad mb-4 flex flex-wrap items-center gap-3">
        <input
          className="input flex-1 min-w-[220px]"
          placeholder="Buscar negocio o enlace…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="accent-brand"
            checked={soloActivos}
            onChange={(e) => setSoloActivos(e.target.checked)}
          />
          Solo activos
        </label>
        <div className="flex rounded-lg border border-line overflow-hidden text-xs font-semibold">
          {(['cuadricula', 'lista'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => cambiarVista(v)}
              className={`px-3 py-2 transition ${vista === v ? 'bg-brand text-white' : 'bg-white text-ink hover:bg-bg2'}`}
            >
              {v === 'cuadricula' ? 'Cuadrícula' : 'Lista'}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="card card-pad text-bad-ink bg-bad-soft">{error}</div>}

      {!error && negocios === null && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card card-pad h-40 animate-pulse bg-bg2/40" />
          ))}
        </div>
      )}

      {negocios !== null && (
        <p className="text-xs text-mute mb-3 tabular-nums">
          {visibles.length} {visibles.length === 1 ? 'negocio' : 'negocios'} · {totalEnlaces}{' '}
          {totalEnlaces === 1 ? 'enlace' : 'enlaces'}
        </p>
      )}

      {negocios !== null && visibles.length === 0 && (
        <div className="card card-pad text-center text-sm text-mute py-10">
          {busqueda ? 'Ningún negocio coincide con la búsqueda.' : 'Todavía ningún negocio tiene InfoLinks.'}
        </div>
      )}

      {vista === 'cuadricula' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibles.map((n) => (
            <TarjetaNegocio key={n.id} n={n} />
          ))}
        </div>
      ) : (
        visibles.length > 0 && (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-mute border-b border-line">
                  <th className="px-4 py-3 font-semibold">Negocio</th>
                  <th className="px-4 py-3 font-semibold">InfoLink</th>
                  <th className="px-4 py-3 font-semibold">Enlace</th>
                  <th className="px-4 py-3 font-semibold text-right">Visitas</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {visibles.flatMap((n) =>
                  n.infolinks.map((il, i) => (
                    <tr key={il.id} className="border-b border-line2 last:border-b-0 align-middle">
                      <td className="px-4 py-2.5">
                        {i === 0 && (
                          <div className="flex items-center gap-2.5">
                            <Logo n={n} size={32} />
                            <span className="font-medium">{n.nombre}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {il.titulo}
                        {!il.activo && <span className="ml-2 chip text-[10px]">Pausado</span>}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-mute">{corto(il.url)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{il.visitas.toLocaleString('es-CO')}</td>
                      <td className="px-4 py-2.5">
                        <AccionesEnlace url={il.url} />
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

function Logo({ n, size }: { n: Negocio; size: number }) {
  const [roto, setRoto] = useState(false);
  if (n.logoUrl && !roto) {
    return (
      // <img> y no next/image: los logos vienen de hosts que la lista de
      // dominios de imagen de Next no siempre tiene, y ahí no se pintan.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={n.logoUrl}
        alt=""
        width={size}
        height={size}
        onError={() => setRoto(true)}
        className="rounded-lg object-contain bg-white border border-line2 shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="rounded-lg bg-brand-soft text-brand font-bold flex items-center justify-center shrink-0"
      style={{ width: size, height: size, fontSize: size / 2.8 }}
    >
      {iniciales(n.nombre)}
    </span>
  );
}

function AccionesEnlace({ url }: { url: string }) {
  return (
    <div className="flex items-center gap-1.5 justify-end shrink-0">
      <button type="button" className="btn-ghost text-xs px-2.5 py-1 min-h-0" onClick={() => copiar(url)}>
        Copiar
      </button>
      <a className="btn-ghost text-xs px-2.5 py-1 min-h-0" href={url} target="_blank" rel="noopener noreferrer">
        Abrir
      </a>
    </div>
  );
}

function TarjetaNegocio({ n }: { n: Negocio }) {
  return (
    <div className="card card-pad flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Logo n={n} size={48} />
        <div className="min-w-0">
          <div className="font-semibold truncate">{n.nombre}</div>
          <div className="text-xs text-mute">
            {n.infolinks.length} {n.infolinks.length === 1 ? 'InfoLink' : 'InfoLinks'}
          </div>
        </div>
      </div>
      <ul className="flex flex-col divide-y divide-line2 border-t border-line2">
        {n.infolinks.map((il) => (
          <li key={il.id} className="flex items-center gap-2 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">
                {il.titulo}
                {!il.activo && <span className="ml-2 chip text-[10px]">Pausado</span>}
              </div>
              <a
                href={il.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs font-mono text-mute truncate hover:text-brand"
              >
                {corto(il.url)}
              </a>
            </div>
            <AccionesEnlace url={il.url} />
          </li>
        ))}
      </ul>
      {n.infolinks.length > 1 && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-bg2/50 px-3 py-2">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-mute font-semibold">Todos sus enlaces</div>
            <div className="text-xs font-mono truncate">{corto(n.urlLista)}</div>
          </div>
          <AccionesEnlace url={n.urlLista} />
        </div>
      )}
    </div>
  );
}

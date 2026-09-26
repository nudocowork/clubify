'use client';
/**
 * Feed de propuestas del Lab. Lo montan `/lab` (página propia), la pestaña
 * «Lab» del panel de afiliado de Clubify y `/admin/lab`, donde el
 * administrador general de una marca blanca tiene el Lab de su marca.
 *
 * El nombre y el color salen de `GET /lab/me`, nunca del código: el feed decía
 * «Clubify Lab» escrito a mano y así se lo encontraba un afiliado de Sellea.
 * Sin marca resuelta, textos neutros. Toda la lógica de carga, filtros y
 * creación vive acá.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, getUser } from '@/lib/api';
import { toast } from '@/components/Toast';
import {
  CATEGORY_META,
  RETIRADA_DEL_PANEL,
  STATUS_META,
  estaRetirada,
  PRIORITY_META,
  colorDeMarca,
  formatRelative,
  NARANJA_MARCA,
  pasosAdelante,
  puedeAdjuntarEnLab,
  type LabCategory,
  type LabPriority,
  type LabStatus,
  type Proposal,
} from './_shared';
import { SubirAdjunto } from './SubirAdjunto';
import { MarcaEtiqueta } from './MarcaEtiqueta';
import { useLabContexto } from './useLabContexto';

type SortBy = 'top' | 'newest' | 'topMonth';

const SORT_OPTIONS: Array<{ value: SortBy; label: string }> = [
  { value: 'top', label: 'Top histórico' },
  { value: 'newest', label: 'Más nuevas' },
  { value: 'topMonth', label: 'Top del mes' },
];

const STATUS_FILTERS: Array<{ value: LabStatus | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Todas' },
  { value: 'EVALUATING', label: 'En evaluación' },
  { value: 'APPROVED', label: 'Aprobadas' },
  { value: 'IN_DEVELOPMENT', label: 'En desarrollo' },
  { value: 'IN_TESTING', label: 'En pruebas' },
  { value: 'IMPLEMENTED', label: 'Implementadas' },
];

function bienvenida(nombre: string | null): string {
  const cuerpo =
    'Acá tú propones mejoras, votas las ideas de la comunidad y comentas. ' +
    'Las más votadas entran al roadmap real del producto.';
  return nombre
    ? `Bienvenido al laboratorio de ${nombre}. ${cuerpo} ¡Tu voz construye ${nombre}!`
    : `Bienvenido al laboratorio. ${cuerpo} ¡Tu voz construye el producto!`;
}

export function LabFeed({
  detalleHref = (id: string) => `/lab/${id}`,
}: {
  /** A dónde lleva cada propuesta: `/lab/<id>` o el detalle dentro del panel. */
  detalleHref?: (id: string) => string;
}) {
  const lab = useLabContexto();
  // Para saber qué propuestas son SUYAS y ofrecerle borrarlas.
  const miId: string | null = getUser()?.id ?? null;
  const contexto = lab.estado === 'listo' ? lab.contexto : null;
  const [category, setCategory] = useState<LabCategory>('CLIENTS');
  const [sortBy, setSortBy] = useState<SortBy>('top');
  const [status, setStatus] = useState<LabStatus | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Proposal[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    setItems(null);
    try {
      const params = new URLSearchParams();
      params.set('category', category);
      params.set('sortBy', sortBy);
      if (status !== 'ALL') params.set('status', status);
      if (q.trim()) params.set('q', q.trim());
      const r = await api<{ items: Proposal[] }>(
        `/lab/proposals?${params.toString()}`,
      );
      setItems(r.items);
    } catch (e: any) {
      toast(e?.message ?? 'Error cargando propuestas', 'error');
      setItems([]);
    }
  }

  async function mover(p: Proposal, estado: LabStatus) {
    try {
      await api(`/admin/lab/proposals/${p.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: estado }),
      });
      toast(`«${p.title}» → ${STATUS_META[estado].label}`, 'success');
      await load();
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo cambiar el estado', 'error');
    }
  }

  /**
   * Borrar una propuesta PROPIA. Esta se borra de verdad, con sus votos y sus
   * comentarios, y es otra cosa que «retirar del panel»: cuando la plataforma
   * quita algo hay que explicárselo a la marca, y cuando uno borra lo suyo no
   * hay a quién explicarle nada.
   *
   * El aviso dice lo que se pierde ANTES de pulsar, y si la propuesta ya se
   * estaba trabajando lo dice con su nombre: borrarla se lleva también el
   * seguimiento que lleva Clubify, y eso no se ve venir.
   */
  async function borrar(p: Proposal) {
    const enMarcha = ['APPROVED', 'IN_DEVELOPMENT', 'IN_TESTING'].includes(
      p.status,
    );
    const ok = window.confirm(
      `¿Borrar «${p.title}»?

` +
        (enMarcha
          ? `Está en «${STATUS_META[p.status].label}»: si la borras, Clubify también pierde su seguimiento.

`
          : '') +
        'Se borra para siempre, con sus votos y sus comentarios. No se puede deshacer.',
    );
    if (!ok) return;
    try {
      await api(`/lab/proposals/${p.id}`, { method: 'DELETE' });
      toast('Propuesta borrada', 'success');
      await load();
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo borrar', 'error');
    }
  }

  useEffect(() => {
    // Hasta saber quién mira no se pide nada: si no tiene acceso, el listado
    // solo repetiría el 403 en un toast.
    if (!contexto) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contexto, category, sortBy, status]);

  if (lab.estado === 'cargando') {
    return <p className="text-mute text-sm">Cargando...</p>;
  }
  if (lab.estado === 'error') {
    return (
      <div className="card card-pad text-center text-mute">{lab.mensaje}</div>
    );
  }

  const nombre = lab.contexto.marca?.name?.trim() || null;
  const deMarca = lab.contexto.alcance === 'MARCA_ADMIN';
  // En una marca blanca la cabecera va con SU color. El tema del panel voltea
  // colores de fondo, no los stops de un degradado `from-brand`, que se quedaba
  // en el verde de Clubify: por eso el color de la marca va directo.
  const colorMarca = deMarca ? colorDeMarca(lab.contexto.marca?.primaryColor) : null;
  // Las propuestas las revisa el equipo de la plataforma. A una marca blanca no
  // se le nombra a nadie: le diría quién está detrás.
  const avisoEnviada =
    !deMarca && nombre
      ? `Propuesta enviada. El equipo de ${nombre} la revisará pronto.`
      : 'Propuesta enviada. Aparecerá en el Lab cuando pase la revisión.';

  return (
    <div>
      <section
        className={`${
          colorMarca ? '' : 'bg-gradient-to-br from-brand to-brand-strong'
        } text-white rounded-2xl p-6 sm:p-8 mb-6`}
        style={colorMarca ? { backgroundColor: colorMarca } : undefined}
      >
        <h1 className="text-2xl sm:text-3xl font-bold m-0">
          🧪 {nombre ? `${nombre} Lab` : 'Lab'}
        </h1>
        <p className="text-white/90 mt-2 text-sm sm:text-base max-w-2xl">
          {bienvenida(nombre)}
        </p>
      </section>

      <div className="flex gap-2 mb-4 flex-wrap">
        {(Object.keys(CATEGORY_META) as LabCategory[]).map((c) => (
          <button
            key={c}
            type="button"
            className={`tab ${category === c ? 'tab-active' : ''}`}
            onClick={() => setCategory(c)}
          >
            <span className="mr-1.5">{CATEGORY_META[c].emoji}</span>
            {CATEGORY_META[c].label}
          </button>
        ))}
      </div>

      <div className="card card-pad mb-4 flex flex-wrap gap-3 items-center">
        <select
          className="input max-w-[180px]"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          className="input flex-1 min-w-[180px]"
          placeholder="Buscar por título o descripción..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') load();
          }}
        />
        <button className="btn-ghost" onClick={load} type="button">
          Buscar
        </button>
        {/* Sesión suplantada desde el panel maestro: la propuesta saldría a
            nombre del administrador real de la marca. */}
        {!lab.contexto.soloLectura && (
          <button
            className="btn-primary ml-auto"
            onClick={() => setShowCreate(true)}
            type="button"
          >
            ➕ Crear propuesta
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.value}
            type="button"
            className={`badge cursor-pointer ${
              status === s.value ? 'badge-info' : 'badge-mute'
            }`}
            onClick={() => setStatus(s.value)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {items === null && (
        <p className="text-mute text-sm">Cargando propuestas...</p>
      )}

      {items && items.length === 0 && (
        <div className="card card-pad text-center text-mute">
          No hay propuestas en este filtro. ¡Sé el primero en proponer una!
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {items?.map((p) => (
          <ProposalCard
            key={p.id}
            proposal={p}
            href={detalleHref(p.id)}
            onMover={(prop, estado) => void mover(prop, estado)}
            // Solo lo suyo, solo si no está ya retirada, y nunca desde una
            // sesión suplantada: borraría a nombre de otro.
            onBorrar={
              p.author.id === miId &&
              !estaRetirada(p) &&
              !lab.contexto.soloLectura
                ? (prop) => void borrar(prop)
                : undefined
            }
          />
        ))}
      </div>

      {showCreate && (
        <CreateModal
          puedeAdjuntar={puedeAdjuntarEnLab(lab.contexto)}
          defaultCategory={category}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            toast(avisoEnviada, 'success');
            load();
          }}
        />
      )}
    </div>
  );
}

/**
 * Una propuesta en el feed.
 *
 * Para el EQUIPO de Clubify, las de una marca blanca salen en NARANJA con el
 * nombre de la marca, y todas traen botones para avanzarlas un paso (Javier,
 * 2026-09-18: «que aparezca en color naranja para ir actualizando el proceso,
 * y que en Sellea vean cómo va»). Lo que se mueve aquí lo ve Humberto en su Lab
 * en el acto: es la misma propuesta.
 *
 * Nadie más ve nada de esto: `brand` y `siguientesEstados` solo los manda el
 * backend al equipo. Un negocio o un embajador de Clubify ve la tarjeta de
 * siempre, y ninguna de Sellea.
 *
 * Los botones van FUERA del enlace: un botón dentro de un `<a>` no es HTML
 * válido, y pulsarlo navegaría al detalle en vez de mover la propuesta.
 */
function ProposalCard({
  proposal,
  href,
  onMover,
  onBorrar,
}: {
  proposal: Proposal;
  href: string;
  onMover?: (p: Proposal, estado: LabStatus) => void;
  /** Solo se pasa cuando la propuesta es SUYA y se puede borrar. */
  onBorrar?: (p: Proposal) => void;
}) {
  const meta = STATUS_META[proposal.status];
  const cat = CATEGORY_META[proposal.category];
  const retirada = estaRetirada(proposal);
  // Una retirada no se mueve de estado: está fuera del panel.
  const adelante = retirada ? [] : pasosAdelante(proposal);
  return (
    <div
      className={`card block transition ${proposal.brand ? NARANJA_MARCA.fila : ''} ${
        retirada ? 'opacity-60' : ''
      }`}
    >
    <Link
      href={href}
      className="card-pad block hover:bg-bg2/40 transition no-underline"
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center min-w-[44px] text-center">
          <div className="text-lg font-bold leading-none">
            {proposal.votesScore}
          </div>
          <div className="text-[10px] text-mute2 uppercase tracking-wide">
            pts
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap gap-1.5 mb-1.5 items-center">
            <span className={`badge ${meta.badge}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
              {meta.label}
            </span>
            <MarcaEtiqueta marca={proposal.brand} />
            <span className="badge badge-mute">
              {cat.emoji} {cat.label}
            </span>
            <span
              className={`text-[11px] font-medium ${PRIORITY_META[proposal.priority].color}`}
            >
              ● {PRIORITY_META[proposal.priority].label}
            </span>
          </div>
          <h3
            className={`text-base font-semibold text-ink mb-1 line-clamp-2 ${
              retirada ? 'line-through' : ''
            }`}
          >
            {proposal.title}
          </h3>
          {/* LA LÁPIDA. Antes la propuesta desaparecía sin más y quien la
              escribió no sabía si se había enviado mal, si se había perdido o
              si alguien la había quitado — y la volvía a mandar. */}
          {retirada ? (
            <p className="text-sm text-mute mb-2">
              <span className="font-semibold">{RETIRADA_DEL_PANEL}</span>
              {proposal.removedReason ? ` ${proposal.removedReason}` : ''}
            </p>
          ) : (
            <p className="text-sm text-mute line-clamp-2 mb-2">
              {proposal.description}
            </p>
          )}
          <div className="text-xs text-mute2 flex gap-3 flex-wrap">
            <span>Por {proposal.author.fullName}</span>
            <span>{formatRelative(proposal.createdAt)}</span>
            <span>💬 {proposal.commentsCount}</span>
            <span>🗳 {proposal.votesCount}</span>
            {proposal.attachmentUrl && <span>📎 Adjunto</span>}
          </div>
        </div>
      </div>
    </Link>
      {((onMover && adelante.length > 0) || onBorrar) && (
        <div className="px-4 pb-3 flex gap-2 flex-wrap items-center">
          {onMover &&
            adelante.map((e) => (
              <button
                key={e}
                className="btn-primary text-xs"
                onClick={() => onMover(proposal, e)}
              >
                → {STATUS_META[e].label}
              </button>
            ))}
          {onBorrar && (
            <button
              className="text-xs font-semibold text-bad hover:underline ml-auto"
              onClick={() => onBorrar(proposal)}
            >
              Borrar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CreateModal({
  defaultCategory,
  puedeAdjuntar,
  onClose,
  onCreated,
}: {
  defaultCategory: LabCategory;
  /** Subir archivos es de las marcas blancas; el resto pega un enlace. */
  puedeAdjuntar: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [expectedBenefit, setExpectedBenefit] = useState('');
  const [category, setCategory] = useState<LabCategory>(defaultCategory);
  const [priority, setPriority] = useState<LabPriority>('MEDIUM');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [attachmentKind, setAttachmentKind] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await api('/lab/proposals', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description,
          category,
          priority,
          expectedBenefit: expectedBenefit || undefined,
          attachmentUrl: attachmentUrl || undefined,
          // Vacío al pegar una URL a mano: el backend deduce el tipo de la
          // extensión, que es lo único que se puede saber sin descargarla.
          attachmentKind: attachmentKind || undefined,
        }),
      });
      onCreated();
    } catch (e: any) {
      toast(e?.message ?? 'Error creando propuesta', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-line flex items-center justify-between">
          <h2 className="font-bold text-lg m-0">➕ Nueva propuesta</h2>
          <button onClick={onClose} className="text-mute hover:text-ink">
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="p-5 grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink">Título</span>
            <input
              required
              minLength={5}
              maxLength={160}
              className="input"
              placeholder="Ej: Permitir editar el QR del menú después de imprimirlo"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink">Categoría</span>
            <select
              className="input"
              value={category}
              onChange={(e) => setCategory(e.target.value as LabCategory)}
            >
              <option value="CLIENTS">🏢 Para negocios (Clientes)</option>
              <option value="AFFILIATES">👥 Para embajadores (Afiliados)</option>
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink">Descripción</span>
            <textarea
              required
              minLength={20}
              maxLength={4000}
              className="input min-h-[120px]"
              placeholder="Explícanos la idea con detalle. ¿Qué problema resuelve?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink">
              Beneficio esperado (opcional)
            </span>
            <textarea
              maxLength={2000}
              className="input min-h-[80px]"
              placeholder="¿Qué impacto tendría en tu negocio o en la comunidad?"
              value={expectedBenefit}
              onChange={(e) => setExpectedBenefit(e.target.value)}
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink">Prioridad</span>
            <select
              className="input"
              value={priority}
              onChange={(e) => setPriority(e.target.value as LabPriority)}
            >
              <option value="LOW">Baja</option>
              <option value="MEDIUM">Media</option>
              <option value="HIGH">Alta</option>
              <option value="CRITICAL">Crítica</option>
            </select>
          </label>
          {puedeAdjuntar ? (
            <div className="grid gap-1.5">
              <span className="text-sm font-medium text-ink">
                Imagen o video (opcional)
              </span>
              <span className="text-xs text-mute2">
                Una captura o un video corto explica en un vistazo lo que quieres
                cambiar.
              </span>
              <SubirAdjunto
                url={attachmentUrl}
                kind={attachmentKind}
                disabled={busy}
                onChange={(url, kind) => {
                  setAttachmentUrl(url);
                  setAttachmentKind(kind);
                }}
              />
            </div>
          ) : (
            // Sin subida (negocios y afiliados de Clubify) queda el campo de
            // siempre: pegar el enlace. Quitárselo sería quitarles algo que ya
            // tenían.
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-ink">
                URL de adjunto (opcional)
              </span>
              <input
                className="input"
                type="url"
                placeholder="https://... (imagen, video, PDF)"
                value={attachmentUrl}
                onChange={(e) => setAttachmentUrl(e.target.value)}
              />
            </label>
          )}
          <div className="flex gap-2 justify-end mt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-ghost"
              disabled={busy}
            >
              Cancelar
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Enviando...' : 'Enviar propuesta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

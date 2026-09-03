'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { CARNET as C, label, limiteTexto, beneficioTitular, iniciales } from '../carnet';

/**
 * LA CARTELERA — grilla pública de beneficios (spec §10).
 *
 * Al tocar una tarjeta se abre la FICHA en un panel, sin cambiar de página: el
 * visitante viene a barrer la grilla, y sacarlo a otra ruta por cada beneficio
 * rompe ese barrido. La ruta profunda igual existe para compartir un beneficio
 * suelto (/cuponera/beneficios/[id]).
 *
 * NO hay código para copiar. Todo es informativo: el beneficio se usa mostrando
 * la tarjeta digital, y el negocio la escanea.
 */

type Sede = { id: string; name: string; address: string; city: string };
type Benefit = {
  id: string;
  type: string;
  title: string;
  description: string;
  terms?: string;
  percentOff: number | null;
  amountOffCents: number | null;
  currency: string | null;
  validUntil: string | null;
  maxPerMember: number | null;
  limitPeriod: string | null;
  ally: { name: string; slug: string; city: string; logoUrl: string | null; locations?: Sede[] } | null;
  category: { name: string; slug: string; icon: string } | null;
};

export default function Cartelera() {
  const [benefits, setBenefits] = useState<Benefit[] | null>(null);
  const [cat, setCat] = useState<string>('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Benefit | null>(null);

  useEffect(() => {
    api<Benefit[]>('/cuponera/public/benefits')
      .then((r) => setBenefits(r ?? []))
      .catch(() => setBenefits([]));
  }, []);

  // Cerrar con Escape: el panel tapa la grilla y quedarse encerrado molesta.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const cats = Array.from(
    new Map((benefits ?? []).filter((b) => b.category).map((b) => [b.category!.slug, b.category!])).values(),
  );

  const visibles = (benefits ?? []).filter((b) => {
    if (cat && b.category?.slug !== cat) return false;
    if (!q.trim()) return true;
    const t = `${b.title} ${b.description} ${b.ally?.name ?? ''} ${b.category?.name ?? ''}`.toLowerCase();
    return t.includes(q.trim().toLowerCase());
  });

  return (
    <div style={{ minHeight: '100vh', background: C.ink, color: C.paper, fontFamily: C.sans }}>
      {/* Encabezado */}
      <header style={{ borderBottom: `1px solid ${C.lineOnInk}`, background: C.inkDeep }}>
        <div style={{ maxWidth: 1120, margin: '0 auto', padding: '20px 20px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div>
              <div style={label()}>Cuponera</div>
              <h1 style={{ margin: '6px 0 0', fontSize: 32, fontWeight: 800, letterSpacing: '-.02em', lineHeight: 1 }}>
                Cuponera Card
              </h1>
              <p style={{ margin: '8px 0 0', color: C.muted, fontSize: 14.5, maxWidth: '44ch', lineHeight: 1.5 }}>
                Los beneficios de la comunidad. Se usan mostrando tu tarjeta en el local.
              </p>
            </div>
            <Link
              href="/cuponera/mi-tarjeta"
              style={{
                ...label(C.ink), background: C.mint, borderRadius: 4,
                padding: '9px 13px', textDecoration: 'none', whiteSpace: 'nowrap',
              }}
            >
              Mi tarjeta
            </Link>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1120, margin: '0 auto', padding: '22px 20px 60px' }}>
        {/* Buscador y filtros (spec §10) */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar negocio o beneficio"
            aria-label="Buscar en la cartelera"
            style={{
              flex: '1 1 220px', padding: '10px 12px', borderRadius: 4,
              border: `1px solid ${C.lineOnInk}`, background: C.ink2, color: C.paper,
              fontSize: 14, fontFamily: C.sans, outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Chip on={!cat} onClick={() => setCat('')}>Todas</Chip>
            {cats.map((c) => (
              <Chip key={c.slug} on={cat === c.slug} onClick={() => setCat(c.slug)}>
                {c.name}
              </Chip>
            ))}
          </div>
        </div>

        <div style={{ ...label(C.muted), marginBottom: 12 }}>
          {benefits === null ? 'Cargando…' : `${visibles.length} ${visibles.length === 1 ? 'beneficio' : 'beneficios'}`}
        </div>

        {benefits !== null && visibles.length === 0 && (
          <div style={{ border: `1px dashed ${C.lineOnInk}`, borderRadius: 4, padding: 28, textAlign: 'center', color: C.muted, fontSize: 14.5 }}>
            {q || cat ? 'Nada coincide con esa búsqueda.' : 'Todavía no hay beneficios publicados.'}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(258px,1fr))', gap: 14 }}>
          {visibles.map((b) => (
            <button
              key={b.id}
              onClick={() => setOpen(b)}
              style={{
                textAlign: 'left', cursor: 'pointer', padding: 0, font: 'inherit', color: 'inherit',
                background: C.ink2, border: `1px solid ${C.lineOnInk}`, borderRadius: 4, overflow: 'hidden',
              }}
            >
              <div style={{
                height: 78, display: 'flex', alignItems: 'flex-end', padding: 9,
                background: `linear-gradient(135deg, #1b5a63, ${C.ink})`,
              }}>
                <Logo url={b.ally?.logoUrl ?? null} name={b.ally?.name ?? ''} />
              </div>
              <div style={{ padding: 13 }}>
                <div style={label()}>{b.category?.name ?? 'Beneficio'}</div>
                <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-.02em', margin: '7px 0 3px' }}>
                  {beneficioTitular(b)}
                </div>
                <div style={{ fontSize: 13.5, lineHeight: 1.4, color: '#e3f0f1' }}>{b.ally?.name}</div>
                <div style={{ fontSize: 12.5, lineHeight: 1.45, color: C.muted, marginTop: 4 }}>{b.title}</div>
                <div style={{
                  marginTop: 11, paddingTop: 9, borderTop: `1px dashed ${C.lineOnInk}`,
                  fontFamily: C.mono, fontSize: 10.5, color: C.muted,
                }}>
                  {limiteTexto(b.maxPerMember, b.limitPeriod)}
                </div>
              </div>
            </button>
          ))}
        </div>
      </main>

      {open && <Ficha b={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...label(on ? C.ink : C.muted),
        background: on ? C.mint : 'transparent',
        border: `1px solid ${on ? C.mint : C.lineOnInk}`,
        borderRadius: 4, padding: '8px 11px', cursor: 'pointer', fontFamily: C.mono,
      }}
    >
      {children}
    </button>
  );
}

function Logo({ url, name }: { url: string | null; name: string }) {
  const base: React.CSSProperties = {
    width: 42, height: 42, borderRadius: 5, flex: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: C.paper, color: C.ink, overflow: 'hidden',
  };
  if (url) return <div style={base}><img src={url} alt={name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /></div>;
  return <div style={{ ...base, fontFamily: C.mono, fontSize: 12, fontWeight: 600 }}>{iniciales(name)}</div>;
}

/** La ficha del beneficio. Informativa: no hay código que copiar. */
function Ficha({ b, onClose }: { b: Benefit; onClose: () => void }) {
  const sedes = b.ally?.locations ?? [];
  const fila = (k: string, v: React.ReactNode) => (
    <tr style={{ borderTop: `1px solid ${C.lineOnPaper}` }}>
      <th style={{ textAlign: 'left', padding: '8px 0', width: '42%', color: C.mutedOnPaper, fontWeight: 600, fontSize: 12.5, verticalAlign: 'top' }}>{k}</th>
      <td style={{ padding: '8px 0', fontSize: 12.5, verticalAlign: 'top' }}>{v}</td>
    </tr>
  );

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${beneficioTitular(b)} en ${b.ally?.name ?? ''}`}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(6,26,31,.72)', zIndex: 50,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '5vh 16px', overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.paper, color: C.ink, borderRadius: 6, width: '100%', maxWidth: 468,
          padding: '22px 22px 24px', backgroundImage: C.guilloche, position: 'relative',
        }}
      >
        <button
          onClick={onClose}
          aria-label="Cerrar"
          style={{
            position: 'absolute', top: 12, right: 12, width: 30, height: 30, borderRadius: '50%',
            border: `1px solid ${C.lineOnPaper}`, background: C.paper, color: C.mutedOnPaper,
            cursor: 'pointer', fontSize: 15, lineHeight: 1,
          }}
        >
          ×
        </button>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', paddingRight: 34 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 5, flex: 'none', overflow: 'hidden',
            background: C.ink, color: C.paper, display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontFamily: C.mono, fontSize: 12, fontWeight: 600,
          }}>
            {b.ally?.logoUrl
              ? <img src={b.ally.logoUrl} alt={b.ally.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              : iniciales(b.ally?.name ?? '')}
          </div>
          <div>
            <div style={{ ...label(C.mutedOnPaper) }}>{b.category?.name ?? 'Beneficio'}</div>
            <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.25, marginTop: 3 }}>
              {beneficioTitular(b)} en {b.ally?.name}
            </div>
          </div>
        </div>

        {/* Donde un sitio de cupones pone el código, acá va la instrucción real. */}
        <div style={{
          margin: '16px 0', padding: 13, border: `1px dashed ${C.mutedOnPaper}`,
          borderRadius: 4, textAlign: 'center',
        }}>
          <div style={label(C.mutedOnPaper)}>Para usarlo</div>
          <div style={{ fontSize: 14.5, fontWeight: 800, marginTop: 4 }}>
            Mostrá tu Cuponera Card en el local
          </div>
          <div style={{ fontSize: 12, color: C.mutedOnPaper, marginTop: 3 }}>
            El negocio la escanea y descuenta el uso.
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {fila('Beneficio', b.description || b.title)}
            {fila('Válido para', 'Socias y socios activos')}
            {fila('Usos', limiteTexto(b.maxPerMember, b.limitPeriod).toLowerCase())}
            {b.validUntil && fila('Vigencia', `Hasta el ${new Date(b.validUntil).toLocaleDateString('es-CO')}`)}
            {sedes.length > 0 && fila(
              sedes.length === 1 ? 'Sede' : 'Sedes',
              sedes.map((s) => (
                <div key={s.id} style={{ marginBottom: 3 }}>
                  <b>{s.name}</b>{s.address ? ` · ${s.address}` : ''}
                </div>
              )),
            )}
            {b.terms && fila('Condiciones', b.terms)}
          </tbody>
        </table>

        <Link
          href={`/cuponera/negocios/${b.ally?.slug ?? ''}`}
          style={{
            display: 'inline-block', marginTop: 15, fontSize: 13, fontWeight: 800,
            color: C.ink, textDecoration: 'none', borderBottom: `2px solid ${C.mint}`,
          }}
        >
          Ver el negocio y cómo llegar
        </Link>
      </div>
    </div>
  );
}

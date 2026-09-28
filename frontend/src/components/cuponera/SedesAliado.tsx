'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import type { MapPickResult } from '@/components/MapPicker';

// Google Maps toca `window` al cargar: import dinámico sin SSR, igual que en
// Sedes del negocio (app/locations).
const MapPicker = dynamic(
  () => import('@/components/MapPicker').then((m) => m.MapPicker),
  { ssr: false, loading: () => <div style={{ height: 320, borderRadius: 10, background: '#f1f5f9' }} /> },
);

const PC = '#0a90bd';
const inp: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid #d7dbe0', borderRadius: 9, fontSize: 13.5, outline: 'none', boxSizing: 'border-box' };
const lbl: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 700, color: '#475569', marginBottom: 4 };
const btn = (bg = PC, color = '#fff'): React.CSSProperties => ({ background: bg, color, border: 'none', padding: '9px 16px', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer' });

export type Sede = {
  id: string;
  name: string;
  address: string;
  city: string;
  latitude: string | number | null;
  longitude: string | number | null;
  radiusMeters: number;
  geopushMessage: string;
  geopushActive: boolean;
  isActive: boolean;
};

type Form = {
  name: string; address: string; city: string;
  lat: number | null; lng: number | null;
  radiusMeters: number; geopushMessage: string; geopushActive: boolean;
};

const VACIA: Form = {
  name: '', address: '', city: '', lat: null, lng: null,
  radiusMeters: 300, geopushMessage: '', geopushActive: true,
};

const aForm = (s: Sede): Form => ({
  name: s.name, address: s.address, city: s.city,
  lat: s.latitude === null ? null : Number(s.latitude),
  lng: s.longitude === null ? null : Number(s.longitude),
  radiusMeters: s.radiusMeters, geopushMessage: s.geopushMessage, geopushActive: s.geopushActive,
});

/**
 * Sedes de UN aliado y su GeoPush (spec §5 y §9).
 *
 * La usan el portal del aliado (`base=/cuponera/ally/locations`) y el panel de
 * la cuponera (`base=/cuponera/panel/allies/<id>/locations` + `qs`). El
 * backend es el mismo en los dos: cada sede con el aviso encendido tiene su
 * punto en la tarjeta, así que una sola pantalla evita que las dos se separen.
 *
 * La ubicación se elige en el mapa de Google, no escribiendo latitud y
 * longitud: pedirle eso a quien atiende un local era la razón de que las
 * sedes quedaran sin coordenadas y el aviso no se pudiera encender.
 */
export function SedesAliado({
  base, qs = '', flash, intro, sinAviso,
}: {
  base: string; qs?: string; flash: (m: string) => void; intro?: React.ReactNode;
  /** Motivo por el que ninguna sede avisa aunque tenga el GeoPush encendido
   *  (p. ej. el aliado aún no está aprobado). Sin esto la pantalla decía
   *  «Activo» sin que le llegara a nadie. */
  sinAviso?: string | null;
}) {
  const [rows, setRows] = useState<Sede[]>([]);
  const [loading, setLoading] = useState(true);
  // null = cerrado; 'nueva' = alta; id = editando esa sede.
  const [editando, setEditando] = useState<string | null>(null);
  const [f, setF] = useState<Form>(VACIA);
  const [guardando, setGuardando] = useState(false);
  // El centro inicial del mapa se fija al abrir el formulario y no sigue al
  // pin: MapPicker recrea el mapa cuando cambia, y atarlo al punto elegido lo
  // reiniciaba con cada clic.
  const [centro, setCentro] = useState<{ initialLat: number; initialLng: number; initialZoom: number } | null>(null);

  // «Cargando» solo la primera vez: en las recargas desmontaba el formulario
  // abierto y el mapa de Google con lo que se estaba escribiendo.
  const cargar = async () => {
    try { setRows(((await api(`${base}${qs}`)) as Sede[]) ?? []); }
    catch { setRows([]); }
    finally { setLoading(false); }
  };
  useEffect(() => { setLoading(true); cargar(); }, [base, qs]);

  // Referencia estable: MapPicker re-centra y hace zoom cada vez que `picked`
  // cambia, y un objeto nuevo por render lo hacía saltar con cada tecla.
  const picked = useMemo(
    () => (f.lat !== null && f.lng !== null ? { name: 'Sede', address: '', lat: f.lat, lng: f.lng } : null),
    [f.lat, f.lng],
  );

  const abrir = (s: Sede | null) => {
    setEditando(s ? s.id : 'nueva');
    const nf = s ? aForm(s) : VACIA;
    setF(nf);
    setCentro(nf.lat !== null && nf.lng !== null ? { initialLat: nf.lat, initialLng: nf.lng, initialZoom: 16 } : null);
  };

  const onPick = (r: MapPickResult) => {
    // La dirección de Google reemplaza la escrita solo si no había una: quien
    // ya puso «Local 3, CC Cabecera» no quiere perderlo por mover el pin.
    setF((p) => ({ ...p, lat: r.lat, lng: r.lng, address: p.address.trim() ? p.address : r.address }));
  };

  async function guardar() {
    if (!f.name.trim()) return flash('La sede necesita un nombre');
    const sinCoords = f.lat === null || f.lng === null;
    if (f.geopushActive && sinCoords) {
      return flash('Para el aviso al pasar cerca, marcá el local en el mapa');
    }
    setGuardando(true);
    try {
      const body = JSON.stringify({
        name: f.name.trim(), address: f.address.trim(), city: f.city.trim(),
        latitude: f.lat, longitude: f.lng,
        radiusMeters: Math.round(Math.min(5000, Math.max(50, Number(f.radiusMeters) || 300))),
        geopushMessage: f.geopushMessage.trim(),
        geopushActive: f.geopushActive && !sinCoords,
      });
      if (editando === 'nueva') {
        await api(`${base}${qs}`, { method: 'POST', body });
        flash('Sede creada');
      } else {
        await api(`${base}/${editando}${qs}`, { method: 'PATCH', body });
        flash('Sede guardada');
      }
      setEditando(null);
      cargar();
    } catch (e: any) { flash(e?.message || 'No se pudo guardar la sede'); }
    finally { setGuardando(false); }
  }

  async function cambiar(s: Sede, cambios: Partial<Sede>) {
    try {
      await api(`${base}/${s.id}${qs}`, { method: 'PATCH', body: JSON.stringify(cambios) });
      cargar();
    } catch (e: any) { flash(e?.message || 'No se pudo guardar'); }
  }

  async function borrar(s: Sede) {
    if (!confirm(`¿Eliminar la sede «${s.name}»? Los canjes ya hechos conservan su historial.`)) return;
    try { await api(`${base}/${s.id}${qs}`, { method: 'DELETE' }); flash('Sede eliminada'); cargar(); }
    catch (e: any) { flash(e?.message || 'No se pudo eliminar'); }
  }

  const formulario = (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, padding: 16, marginBottom: 14 }}>
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 12 }}>
        {editando === 'nueva' ? 'Nueva sede' : 'Editar sede'}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
        <div>
          <label style={lbl}>Nombre de la sede *</label>
          <input style={inp} placeholder="Cabecera" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div>
          <label style={lbl}>Dirección</label>
          <input style={inp} placeholder="Calle 42 #30-15" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </div>
        <div>
          <label style={lbl}>Ciudad</label>
          <input style={inp} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={lbl}>Ubicación en el mapa</label>
        <MapPicker
          height={320}
          {...(centro ?? {})}
          picked={picked}
          onPick={onPick}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginTop: 14 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={{ display: 'flex', gap: 9, alignItems: 'center', cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={f.geopushActive} onChange={(e) => setF({ ...f, geopushActive: e.target.checked })} />
            <b>Avisar a quien pase cerca con la tarjeta (GeoPush)</b>
          </label>
        </div>
        {f.geopushActive && (
          <>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={lbl}>Mensaje del aviso</label>
              <input style={inp} maxLength={200} placeholder="Estás cerca: 15% OFF con tu tarjeta" value={f.geopushMessage}
                onChange={(e) => setF({ ...f, geopushMessage: e.target.value })} />
              <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 4 }}>
                Sale en la pantalla bloqueada del celular. Vacío: «Estás cerca de» y el nombre del negocio.
              </div>
            </div>
            <div>
              <label style={lbl}>Radio (metros)</label>
              <input style={inp} type="number" min={50} max={5000} value={f.radiusMeters}
                onChange={(e) => setF({ ...f, radiusMeters: Number(e.target.value) })} />
            </div>
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button style={btn()} disabled={guardando} onClick={guardar}>
          {guardando ? 'Guardando…' : editando === 'nueva' ? 'Crear sede' : 'Guardar sede'}
        </button>
        <button style={btn('#eef2f7', '#111827')} onClick={() => setEditando(null)}>Cancelar</button>
      </div>
    </div>
  );

  if (loading) return <div style={{ color: '#64748b', fontSize: 14 }}>Cargando sedes…</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          {intro ?? 'Los locales del negocio. Cada uno puede avisar a quien pase cerca con su tarjeta.'}
        </div>
        {editando === null && <button style={btn()} onClick={() => abrir(null)}>+ Agregar sede</button>}
      </div>

      {sinAviso && (
        <div style={{ fontSize: 11.5, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>
          {sinAviso}
        </div>
      )}

      {editando === 'nueva' && formulario}

      {rows.length === 0 && editando === null && (
        <div style={{ background: '#fff', border: '1px solid #eef0f3', borderRadius: 14, padding: 20, textAlign: 'center', color: '#64748b', fontSize: 13.5 }}>
          Todavía no hay ninguna sede.
        </div>
      )}

      {rows.map((s) => {
        if (editando === s.id) return <div key={s.id}>{formulario}</div>;
        const sinCoords = s.latitude === null || s.longitude === null;
        return (
          <div key={s.id} style={{ background: '#fff', border: '1px solid #eef0f3', borderRadius: 14, padding: 16, marginBottom: 12, opacity: s.isActive ? 1 : 0.6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <b style={{ fontSize: 15 }}>{s.name}</b>
                <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2 }}>
                  {[s.address, s.city].filter(Boolean).join(' · ') || 'Sin dirección'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <button style={{ ...btn('#eef2f7', '#111827'), padding: '7px 12px' }} onClick={() => abrir(s)}>Editar</button>
                <button style={{ ...btn('#eef2f7', '#111827'), padding: '7px 12px' }} onClick={() => cambiar(s, { isActive: !s.isActive })}>
                  {s.isActive ? 'Desactivar' : 'Activar'}
                </button>
                <button style={{ ...btn('#fee2e2', '#991b1b'), padding: '7px 12px' }} onClick={() => borrar(s)}>Eliminar</button>
              </div>
            </div>

            <div style={{ marginTop: 12, borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 13 }}>
                  <b>GeoPush</b>
                  <span style={{ color: '#64748b', marginLeft: 6 }}>· radio {s.radiusMeters} m</span>
                </div>
                <button
                  style={{ ...btn(s.geopushActive ? '#16a34a' : '#eef2f7', s.geopushActive ? '#fff' : '#111827'), padding: '6px 12px', opacity: sinCoords ? 0.5 : 1 }}
                  disabled={sinCoords}
                  onClick={() => cambiar(s, { geopushActive: !s.geopushActive })}
                >
                  {s.geopushActive ? 'Activo' : 'Apagado'}
                </button>
              </div>
              {sinCoords && (
                <div style={{ fontSize: 11.5, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '7px 10px', marginTop: 8 }}>
                  Esta sede no está marcada en el mapa, así que no puede avisar a nadie. Tocá <b>Editar</b> y ubicala.
                </div>
              )}
              {s.geopushActive && !s.isActive && (
                <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 6 }}>
                  La sede está desactivada: el aviso no sale hasta que la actives.
                </div>
              )}
              {s.geopushMessage && !sinCoords && (
                <div style={{ fontSize: 12.5, color: '#334155', marginTop: 6, fontStyle: 'italic' }}>“{s.geopushMessage}”</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

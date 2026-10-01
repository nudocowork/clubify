'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

const PC = '#0a90bd';
const API = process.env.NEXT_PUBLIC_API_URL ?? '';

type Pass = { id: string; serialNumber: string; memberName: string };
type StampProg = { id: string; name: string; rewardText: string; stampsCount: number; stampsRequired: number };

export default function MiTarjetaPage() {
  // Se llama `q` porque acepta teléfono o correo: quien compró por Hotmart o
  // Stripe puede no haber dejado teléfono nunca.
  const [q, setQ] = useState('');
  const [passes, setPasses] = useState<Pass[] | null>(null);
  const [stamps, setStamps] = useState<StampProg[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  // El texto con el que SE BUSCÓ (no el que se está tecleando): es la llave
  // con la que el plan familiar consulta y agrega.
  const [qUsada, setQUsada] = useState('');

  async function search() {
    const texto = q.trim();
    const esEmail = texto.includes('@');
    if (!esEmail && texto.replace(/\D/g, '').length < 7) return;
    setLoading(true);
    setSearched(true);
    setQUsada(texto);
    try {
      const [r, s] = await Promise.all([
        api<{ passes: Pass[] }>(`/cuponera/public/card/find?q=${encodeURIComponent(texto)}`),
        // Los sellos siguen siendo por teléfono; con un correo no aplican.
        esEmail
          ? Promise.resolve({ programs: [] as StampProg[] })
          : api<{ programs: StampProg[] }>(`/cuponera/public/stamps/by-phone?phone=${encodeURIComponent(texto)}`).catch(() => ({ programs: [] })),
      ]);
      setPasses(r.passes);
      setStamps(s.programs ?? []);
    } catch {
      setPasses([]);
      setStamps([]);
    } finally {
      setLoading(false);
    }
  }

  async function addGoogle(passId: string) {
    try {
      const r = await api<{ saveUrl: string }>(`/passes/${passId}/google`);
      if (r.saveUrl) window.location.href = r.saveUrl;
    } catch {
      alert('No se pudo generar la tarjeta de Google Wallet.');
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '0 20px 80px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '22px 0' }}>
        <Link href="/cuponera" style={{ fontWeight: 900, fontSize: 20, color: PC, textDecoration: 'none' }}>🎟️ Cuponera Card</Link>
      </header>

      <div style={{ background: '#fff', borderRadius: 20, padding: '30px 26px', boxShadow: '0 8px 30px rgba(0,0,0,.07)', marginTop: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 6px' }}>Mi tarjeta</h1>
        <p style={{ color: '#64748b', fontSize: 14, marginBottom: 20 }}>
          Ingresá tu teléfono o el correo con el que compraste para recuperar tu
          Cuponera Card y añadirla a Apple o Google Wallet.
        </p>

        <div style={{ display: 'flex', gap: 10 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="+57 300 000 0000 o tu@correo.com"
            style={{ flex: 1, padding: '12px 14px', border: '1px solid #d7dbe0', borderRadius: 11, fontSize: 15, outline: 'none' }}
          />
          <button onClick={search} disabled={loading} style={{ background: PC, color: '#fff', border: 'none', padding: '0 20px', borderRadius: 11, fontWeight: 800, cursor: 'pointer', fontSize: 14 }}>
            {loading ? '…' : 'Buscar'}
          </button>
        </div>

        {searched && !loading && passes && passes.length === 0 && (
          <div style={{ marginTop: 22, padding: 16, background: '#fef2f2', borderRadius: 12, fontSize: 13.5, color: '#991b1b' }}>
            No encontramos una tarjeta con ese teléfono. ¿Aún no eres miembro?{' '}
            <Link href="/cuponera" style={{ color: PC, fontWeight: 700 }}>Únete aquí</Link>.
          </div>
        )}

        {passes && passes.length > 0 && (
          <div style={{ marginTop: 24 }}>
            {passes.map((p) => (
              <div key={p.id} style={{ border: '1px solid #e2e8f0', borderRadius: 16, padding: 18, marginBottom: 14 }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{p.memberName}</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 14 }}>N° {p.serialNumber}</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <a
                    href={`${API}/api/passes/${p.id}/apple.pkpass`}
                    style={{ flex: 1, minWidth: 150, textAlign: 'center', background: '#000', color: '#fff', padding: '11px 14px', borderRadius: 10, fontWeight: 700, textDecoration: 'none', fontSize: 13.5 }}
                  >
                     Añadir a Apple Wallet
                  </a>
                  <button
                    onClick={() => addGoogle(p.id)}
                    style={{ flex: 1, minWidth: 150, background: '#fff', color: '#0f172a', border: '1.5px solid #e2e8f0', padding: '11px 14px', borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontSize: 13.5 }}
                  >
                    Añadir a Google Wallet
                  </button>
                </div>
              </div>
            ))}

            {stamps.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', margin: '4px 0 10px' }}>MIS SELLOS</div>
                {stamps.map((s) => (
                  <div key={s.id} style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 14, marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
                      <b>{s.name}</b>
                      <span style={{ color: PC, fontWeight: 700 }}>{s.stampsCount}/{s.stampsRequired}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
                      {Array.from({ length: s.stampsRequired }).map((_, i) => (
                        <div key={i} style={{ width: 20, height: 20, borderRadius: '50%', background: i < s.stampsCount ? PC : '#e2e8f0' }} />
                      ))}
                    </div>
                    {s.rewardText && <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>🎁 {s.rewardText}</div>}
                  </div>
                ))}
              </div>
            )}
            <MiFamilia key={qUsada} q={qUsada} />
          </div>
        )}
      </div>
    </div>
  );
}

type FamiliaPublica = {
  enabled: boolean; max?: number; usados?: number;
  links?: { id: string; fullName: string; status: string }[];
  titular?: { fullName: string; usable: boolean };
};

/**
 * Plan familiar del titular: agrega hasta N familiares y a cada uno se le
 * emite SU tarjeta en el acto. Solo aparece si la membresía encontrada tiene
 * un plan familiar; para el resto, esta sección no existe.
 */
function MiFamilia({ q }: { q: string }) {
  const [v, setV] = useState<FamiliaPublica | null>(null);
  const [f, setF] = useState({ fullName: '', phone: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const cargar = () =>
    api<FamiliaPublica>(`/cuponera/public/family-links?q=${encodeURIComponent(q)}`)
      .then(setV)
      .catch(() => setV(null));
  useEffect(() => { cargar(); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!v?.enabled) return null;
  const cupo = (v.max ?? 0) - (v.usados ?? 0);

  async function agregar() {
    setErr(null); setMsg(null);
    if (!f.fullName.trim()) return setErr('Poné el nombre del familiar.');
    if (!f.phone.replace(/\D/g, '').length && !f.email.trim()) {
      return setErr('Dejá su teléfono o su correo: con eso recupera su tarjeta en esta página.');
    }
    setBusy(true);
    try {
      const r = await api<{ fullName: string }>('/cuponera/public/family-link', {
        method: 'POST',
        body: JSON.stringify({ q, fullName: f.fullName.trim(), phone: f.phone, email: f.email || undefined }),
      });
      setMsg(`Listo: ${r.fullName} ya tiene su tarjeta. Puede descargarla en esta misma página buscando con SU teléfono o correo.`);
      setF({ fullName: '', phone: '', email: '' });
      cargar();
    } catch (e: any) { setErr(e?.message || 'No se pudo agregar.'); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 18, border: '1px solid #e2e8f0', borderRadius: 16, padding: 18 }}>
      <div style={{ fontWeight: 800, fontSize: 15 }}>Tu plan familiar</div>
      <div style={{ fontSize: 12.5, color: '#64748b', margin: '3px 0 12px' }}>
        {v.usados} de {v.max} {v.max === 1 ? 'tarjeta enlazada' : 'tarjetas enlazadas'}. Cada familiar
        recibe su propia tarjeta y canjea mientras tu suscripción esté al día.
      </div>
      {(v.links ?? []).map((l) => (
        <div key={l.id} style={{ fontSize: 13.5, padding: '6px 0', borderBottom: '1px solid #f1f5f9' }}>
          👤 <b>{l.fullName}</b>
        </div>
      ))}
      {msg && <div style={{ marginTop: 10, background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: 10, padding: '9px 12px', fontSize: 13 }}>{msg}</div>}
      {err && <div style={{ marginTop: 10, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 10, padding: '9px 12px', fontSize: 13 }}>{err}</div>}
      {cupo > 0 ? (
        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          <input
            value={f.fullName}
            onChange={(e) => setF({ ...f, fullName: e.target.value })}
            placeholder="Nombre del familiar"
            style={{ padding: '11px 13px', border: '1px solid #d7dbe0', borderRadius: 10, fontSize: 14, outline: 'none' }}
          />
          <input
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
            placeholder="Su teléfono (+57 300 000 0000)"
            style={{ padding: '11px 13px', border: '1px solid #d7dbe0', borderRadius: 10, fontSize: 14, outline: 'none' }}
          />
          <input
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
            placeholder="Su correo (opcional)"
            style={{ padding: '11px 13px', border: '1px solid #d7dbe0', borderRadius: 10, fontSize: 14, outline: 'none' }}
          />
          <button onClick={agregar} disabled={busy}
            style={{ background: PC, color: '#fff', border: 'none', padding: '12px 14px', borderRadius: 10, fontWeight: 800, cursor: 'pointer', fontSize: 14 }}>
            {busy ? 'Creando su tarjeta…' : 'Agregar familiar y crear su tarjeta'}
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 10 }}>
          Ya usaste todas las tarjetas de tu plan. Para cambiar a alguien, pedíselo a la cuponera.
        </div>
      )}
    </div>
  );
}

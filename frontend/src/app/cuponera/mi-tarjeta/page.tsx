'use client';
import { useState } from 'react';
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

  async function search() {
    const texto = q.trim();
    const esEmail = texto.includes('@');
    if (!esEmail && texto.replace(/\D/g, '').length < 7) return;
    setLoading(true);
    setSearched(true);
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
        <Link href="/cuponera" style={{ fontWeight: 900, fontSize: 20, color: PC, textDecoration: 'none' }}>🎟️ Living Card</Link>
      </header>

      <div style={{ background: '#fff', borderRadius: 20, padding: '30px 26px', boxShadow: '0 8px 30px rgba(0,0,0,.07)', marginTop: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 6px' }}>Mi tarjeta</h1>
        <p style={{ color: '#64748b', fontSize: 14, marginBottom: 20 }}>
          Ingresá tu teléfono o el correo con el que compraste para recuperar tu
          Living Card y añadirla a Apple o Google Wallet.
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
          </div>
        )}
      </div>
    </div>
  );
}

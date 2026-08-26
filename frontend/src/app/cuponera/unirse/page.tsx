'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

const PC = '#0a90bd';

type Plan = {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  interval: 'MONTHLY' | 'ANNUAL';
  description: string;
  benefitsAllowance: number | null;
  /** Link de compra de la pasarela (Hotmart/Stripe). Vacío = se cobra por
   *  MercadoPago con el formulario de acá. */
  checkoutUrl?: string | null;
  checkoutGateway?: 'HOTMART' | 'STRIPE' | 'MERCADOPAGO';
};

const money = (cents: number, currency = 'COP') =>
  currency === 'COP'
    ? `$ ${Number(cents || 0).toLocaleString('es-CO')}`
    : `${currency} ${(Number(cents || 0) / 100).toFixed(2)}`;

const inp: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  border: '1px solid #d7dbe0',
  borderRadius: 11,
  fontSize: 15,
  outline: 'none',
};

export default function UnirsePage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ fullName: '', phone: '', email: '' });
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setPlanId(sp.get('plan') || '');
    api<{ plans: Plan[] }>('/cuponera/public/campaign')
      .then((d) => setPlans(d.plans))
      .catch(() => setPlans([]))
      .finally(() => setLoading(false));
  }, []);

  const selected = plans.find((p) => p.id === planId) || plans[0] || null;
  const externo = !!selected?.checkoutUrl;
  const nombrePasarela =
    selected?.checkoutGateway === 'HOTMART'
      ? 'Hotmart'
      : selected?.checkoutGateway === 'STRIPE'
        ? 'Stripe'
        : 'MercadoPago';

  async function pay() {
    setNotice(null);
    if (!selected) return;

    // Hotmart y Stripe se cobran en un link que ya existe: el comprador va
    // directo y el alta la hace el webhook. No se pide teléfono porque esas
    // pasarelas no lo exigen, y pedirlo acá solo agrega una barrera a la venta.
    if (selected.checkoutUrl) {
      window.location.href = selected.checkoutUrl;
      return;
    }

    if (!form.fullName.trim() || form.phone.replace(/\D/g, '').length < 8 || !form.email.trim()) {
      setNotice('Completa nombre, teléfono y email.');
      return;
    }
    setSubmitting(true);
    try {
      const r = await api<{ initPoint: string | null }>('/cuponera/public/subscribe', {
        method: 'POST',
        body: JSON.stringify({ planId: selected.id, ...form }),
      });
      if (r.initPoint) {
        window.location.href = r.initPoint;
      } else {
        setNotice('No se pudo iniciar el pago. Intenta de nuevo.');
      }
    } catch (e: any) {
      // Ej: "MercadoPago no está configurado todavía."
      setNotice(
        (e?.message && String(e.message)) ||
          'El pago en línea aún no está disponible. Un asesor puede activarte la membresía.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '0 20px 80px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '22px 0' }}>
        <Link href="/cuponera" style={{ fontWeight: 900, fontSize: 20, color: PC, textDecoration: 'none' }}>🎟️ Living Card</Link>
        <Link href="/cuponera/mi-tarjeta" style={{ fontSize: 13.5, fontWeight: 700, color: PC, textDecoration: 'none' }}>Ya soy miembro</Link>
      </header>

      <div style={{ background: '#fff', borderRadius: 20, padding: '30px 26px', boxShadow: '0 8px 30px rgba(0,0,0,.07)', marginTop: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 900, margin: '0 0 6px' }}>Unirme a Living Card</h1>
        <p style={{ color: '#64748b', fontSize: 14, marginBottom: 22 }}>Elige tu plan y completa tu membresía.</p>

        {loading ? (
          <div style={{ color: '#94a3b8' }}>Cargando planes…</div>
        ) : plans.length === 0 ? (
          <div style={{ color: '#94a3b8' }}>Aún no hay planes disponibles.</div>
        ) : (
          <>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Plan</label>
            <select value={selected?.id || ''} onChange={(e) => setPlanId(e.target.value)} style={{ ...inp, marginBottom: 18 }}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {money(p.priceCents, p.currency)} {p.interval === 'ANNUAL' ? '/ año' : '/ mes'}
                </option>
              ))}
            </select>

            {selected && (
              <div style={{ border: `1.5px solid ${PC}`, borderRadius: 14, padding: 18, marginBottom: 20 }}>
                <div style={{ fontWeight: 800, fontSize: 17 }}>{selected.name}</div>
                <div style={{ fontSize: 28, fontWeight: 900, color: PC, margin: '6px 0' }}>
                  {money(selected.priceCents, selected.currency)}
                  <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}> {selected.interval === 'ANNUAL' ? '/ año' : '/ mes'}</span>
                </div>
                {selected.description && <p style={{ fontSize: 13.5, color: '#475569' }}>{selected.description}</p>}
                <div style={{ fontSize: 13, color: '#334155', marginTop: 6 }}>
                  ✓ {selected.benefitsAllowance != null ? `${selected.benefitsAllowance} beneficios` : 'Beneficios ilimitados'}
                </div>
              </div>
            )}

            {/* Con link externo, los datos los pide la pasarela: repetirlos acá
                solo agrega una barrera antes de pagar. */}
            {!externo && (
              <div style={{ display: 'grid', gap: 12, marginBottom: 18 }}>
                <input style={inp} placeholder="Nombre completo" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
                <input style={inp} placeholder="Teléfono (+57 300 000 0000)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                <input style={inp} placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            )}

            <button
              onClick={pay}
              disabled={submitting}
              style={{ width: '100%', background: PC, color: '#fff', border: 'none', padding: '14px', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: submitting ? 'wait' : 'pointer' }}
            >
              {submitting ? 'Redirigiendo…' : `Pagar con ${nombrePasarela}`}
            </button>

            {externo && (
              <div style={{ marginTop: 14, fontSize: 12.5, color: '#64748b', lineHeight: 1.6 }}>
                Al terminar el pago, volvé acá y entrá a{' '}
                <a href="/cuponera/mi-tarjeta" style={{ color: PC, fontWeight: 700 }}>Mi tarjeta</a>{' '}
                con el mismo correo con el que compraste para descargarla.
              </div>
            )}

            {notice && (
              <div style={{ marginTop: 14, padding: 14, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, fontSize: 13, color: '#9a3412' }}>
                {notice}
              </div>
            )}
            <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', marginTop: 12 }}>
              Suscripción recurrente. Puedes cancelar cuando quieras.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

/**
 * Checkout de Cross (API directa) con el look del Stripe Checkout hospedado.
 * Público. Cobra en USD. Colecta la tarjeta y la envía a /api/billing/cross/checkout
 * (el backend la reenvía a Cross /payments/process; PCI: no se persiste acá).
 * La activación de la cuenta la confirma el webhook transaction.status_updated.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? '';

const CSS = `
.cx *{box-sizing:border-box}
.cx{--ink:#30313d;--ink-strong:#1a1b25;--muted:#6a7383;--faint:#8792a2;--line:#e6e6e9;--line-soft:#eceef1;
  --accent:#635bff;--btn:#0a2540;--btn-hover:#122c4d;--focus:rgba(99,91,255,.25);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}
.cx-wrap{display:grid;grid-template-columns:1fr 1fr;min-height:100vh;background:#fff}
@media(max-width:860px){.cx-wrap{grid-template-columns:1fr}}
.cx-left{display:flex;justify-content:flex-end;padding:56px 48px}
.cx-left .in{width:100%;max-width:380px}
@media(max-width:860px){.cx-left{justify-content:center;padding:22px 20px 8px;border-bottom:1px solid var(--line-soft)}}
.cx-merch{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:14px;font-weight:500;margin-bottom:34px}
.cx-merch .m{width:26px;height:26px;border-radius:7px;background:linear-gradient(150deg,#28c95f,#16a34a);display:grid;place-items:center;color:#fff;font-weight:800;font-size:13px}
.cx-plabel{color:var(--muted);font-size:15px;margin:0 0 6px}
.cx-amt{font-size:36px;font-weight:600;letter-spacing:-.02em;color:var(--ink-strong);margin:0 0 4px;font-variant-numeric:tabular-nums}
.cx-note{color:var(--faint);font-size:13.5px;margin:0 0 34px}
.cx-li{display:flex;justify-content:space-between;gap:12px;padding:14px 0;border-top:1px solid var(--line-soft);font-size:14px}
.cx-li.tot{border-top:1px solid var(--line);font-weight:600;color:var(--ink-strong);padding-top:16px}
.cx-lfoot{margin-top:40px;color:var(--faint);font-size:12px}
@media(max-width:860px){.cx-li,.cx-lfoot{display:none}}
.cx-right{display:flex;justify-content:flex-start;padding:56px 48px;border-left:1px solid var(--line-soft)}
@media(max-width:860px){.cx-right{justify-content:center;padding:22px 20px 40px;border-left:none}}
.cx-right .in{width:100%;max-width:380px}
.cx-title{font-size:15px;font-weight:600;color:var(--ink-strong);margin:0 0 14px}
.cx label{display:block;font-size:13px;font-weight:500;color:var(--ink);margin:0 0 6px}
.cx-field{margin-bottom:14px}
.cx-inp{width:100%;border:1px solid var(--line);border-radius:7px;padding:11px 12px;font-size:15px;color:var(--ink-strong);background:#fff;transition:box-shadow .12s,border-color .12s}
.cx-inp:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--focus)}
.cx-card{border:1px solid var(--line);border-radius:7px;overflow:hidden;transition:box-shadow .12s,border-color .12s}
.cx-card:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--focus)}
.cx-card input{border:none;width:100%;padding:11px 12px;font-size:15px;color:var(--ink-strong)}
.cx-card input:focus{outline:none}
.cx-card .sp{display:flex;border-top:1px solid var(--line)}
.cx-card .sp input:first-child{border-right:1px solid var(--line)}
.cx-two{display:flex;gap:10px}.cx-two>div{flex:1}
.cx-pay{width:100%;background:var(--btn);color:#fff;border:none;border-radius:7px;padding:12px;font-size:15px;font-weight:600;cursor:pointer;transition:background .15s;margin-top:6px}
.cx-pay:hover{background:var(--btn-hover)}.cx-pay:disabled{opacity:.6;cursor:default}
.cx-re{margin-top:14px;text-align:center;color:var(--faint);font-size:12.5px}
.cx-err{margin-top:12px;background:#fff1f0;border:1px solid #ffccc7;color:#a8071a;border-radius:8px;padding:10px 12px;font-size:13px}
.cx-ok{text-align:center;padding:20px 0}
.cx-tick{width:56px;height:56px;border-radius:50%;margin:0 auto 14px;display:grid;place-items:center;background:#e7f7ee;color:#16a34a;font-size:28px}
.cx-sel{width:100%;border:1px solid var(--line);border-radius:7px;padding:11px 12px;font-size:15px;background:#fff}
.cx-sel:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--focus)}
`;

function fmtCard(v: string) {
  return v.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim();
}

export default function CrossCheckoutPage() {
  const params = useParams();
  const search = useSearchParams();
  const slug = String((params as any)?.slug ?? '');
  const emailQ = search.get('email') ?? '';

  const [info, setInfo] = useState<{ brandName?: string; amountUsd?: number | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<null | { status: string }>(null);

  const [email, setEmail] = useState(emailQ);
  const [cn, setCn] = useState('');
  const [exp, setExp] = useState('');
  const [cvc, setCvc] = useState('');
  const [name, setName] = useState('');
  const [doc, setDoc] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('Colombia');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${API}/api/billing/cross/checkout-info`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brandSlug: slug }),
        });
        const d = await r.json();
        if (alive) setInfo(d);
      } catch {
        if (alive) setInfo({ brandName: undefined, amountUsd: null });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug]);

  const amount = info?.amountUsd ?? null;
  const amountStr = useMemo(
    () => (amount != null ? `US$ ${amount.toFixed(2)}` : '—'),
    [amount],
  );

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    const digits = cn.replace(/\D/g, '');
    const [mm, yy] = exp.split('/').map((s) => s.trim());
    if (digits.length < 13 || !mm || !yy || cvc.length < 3) {
      setErr('Revisá los datos de la tarjeta.');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/billing/cross/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandSlug: slug,
          email: email.trim(),
          customerName: name.trim(),
          document: doc.trim(),
          phone: phone.trim(),
          cardNumber: digits,
          expMonth: Number(mm),
          expYear: yy.length === 2 ? 2000 + Number(yy) : Number(yy),
          cvc: cvc.trim(),
          holderName: name.trim(),
          redirectUrl:
            typeof window !== 'undefined'
              ? `${window.location.origin}/activar?email=${encodeURIComponent(email.trim())}`
              : undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok || d?.ok === false) {
        setErr(d?.message || 'No se pudo procesar el pago.');
        setBusy(false);
        return;
      }
      // 3-D Secure / confirmación → redirigir.
      if (d?.redirectUrl) {
        window.location.href = d.redirectUrl;
        return;
      }
      setDone({ status: d?.status || 'PENDING' });
    } catch {
      setErr('Error de red. Intentá de nuevo.');
      setBusy(false);
    }
  }

  return (
    <div className="cx">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="cx-wrap">
        {/* LEFT */}
        <div className="cx-left">
          <div className="in">
            <div className="cx-merch">
              <span className="m">{(info?.brandName ?? 'C').slice(0, 1).toUpperCase()}</span>
              {info?.brandName ?? 'Clubify'}
            </div>
            <p className="cx-plabel">Prueba de integración</p>
            <div className="cx-amt">{amountStr}</div>
            <p className="cx-note">Cobro único · pagas a VIRTUALPRO&nbsp;S.A.S.</p>
            <div className="cx-li">
              <span>Suscripción Clubify</span>
              <span>{amountStr}</span>
            </div>
            <div className="cx-li tot">
              <span>Total a pagar</span>
              <span>{amountStr}</span>
            </div>
            <div className="cx-lfoot">Procesado por Cross · pago seguro</div>
          </div>
        </div>

        {/* RIGHT */}
        <div className="cx-right">
          <div className="in">
            {loading ? (
              <p className="cx-title">Cargando…</p>
            ) : done ? (
              <div className="cx-ok">
                <div className="cx-tick">✓</div>
                <h3 style={{ margin: '0 0 6px' }}>
                  {done.status === 'APPROVED' ? '¡Pago aprobado!' : 'Pago recibido'}
                </h3>
                <p style={{ color: 'var(--muted)', fontSize: 14 }}>
                  {done.status === 'APPROVED'
                    ? 'Tu cuenta se está activando. En un momento podrás ingresar.'
                    : 'Estamos confirmando tu pago. Te avisaremos cuando se acredite.'}
                </p>
              </div>
            ) : amount == null ? (
              <div className="cx-err">
                Esta marca todavía no tiene un plan de pago Cross configurado.
              </div>
            ) : (
              <form onSubmit={pay}>
                <p className="cx-title">Pagar con tarjeta</p>
                <div className="cx-field">
                  <label>Email</label>
                  <input
                    className="cx-inp"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@correo.com"
                  />
                </div>
                <div className="cx-field">
                  <label>Información de la tarjeta</label>
                  <div className="cx-card">
                    <input
                      inputMode="numeric"
                      placeholder="1234 1234 1234 1234"
                      value={cn}
                      maxLength={23}
                      onChange={(e) => setCn(fmtCard(e.target.value))}
                    />
                    <div className="sp">
                      <input
                        placeholder="MM / AA"
                        value={exp}
                        maxLength={7}
                        onChange={(e) => {
                          let v = e.target.value.replace(/\D/g, '').slice(0, 4);
                          if (v.length >= 3) v = v.slice(0, 2) + ' / ' + v.slice(2);
                          setExp(v);
                        }}
                      />
                      <input
                        inputMode="numeric"
                        placeholder="CVC"
                        value={cvc}
                        maxLength={4}
                        onChange={(e) => setCvc(e.target.value.replace(/\D/g, ''))}
                      />
                    </div>
                  </div>
                </div>
                <div className="cx-field">
                  <label>Nombre del titular</label>
                  <input className="cx-inp" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre completo" />
                </div>
                <div className="cx-two">
                  <div className="cx-field">
                    <label>Documento</label>
                    <input className="cx-inp" value={doc} onChange={(e) => setDoc(e.target.value)} placeholder="Nº documento" />
                  </div>
                  <div className="cx-field">
                    <label>Teléfono</label>
                    <input className="cx-inp" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="300 123 4567" />
                  </div>
                </div>
                <div className="cx-field">
                  <label>País o región</label>
                  <select className="cx-sel" value={country} onChange={(e) => setCountry(e.target.value)}>
                    <option>Colombia</option>
                    <option>Estados Unidos</option>
                    <option>México</option>
                    <option>Argentina</option>
                    <option>España</option>
                  </select>
                </div>
                {err && <div className="cx-err">{err}</div>}
                <button className="cx-pay" type="submit" disabled={busy}>
                  {busy ? 'Procesando…' : `Pagar ${amountStr}`}
                </button>
                <div className="cx-re">🔒 Pago cifrado y procesado por Cross</div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

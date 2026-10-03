'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { PhoneInput } from '@/components/PhoneInput';
import { BUSINESS_CATEGORIES, DEFAULT_CATEGORY_SLUG } from '@/lib/business-categories';

/**
 * Formulario de pago por fuera de cada closer (Sara, 2026-10-03).
 *
 * El closer entra por SU enlace: el afiliado del pago sale de ahí y no se
 * puede olvidar ni equivocar. Enviarlo NO activa nada: queda en «Pendientes de
 * aprobación» hasta que alguien compruebe que el dinero llegó.
 */

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Enlace = { closer: string; marca: { nombre: string; logoUrl: string | null } | null };
type Errores = Record<string, string>;

const PERIODOS = [
  { v: 'MENSUAL', label: 'Mensual' },
  { v: 'TRIMESTRAL', label: 'Trimestral' },
  { v: 'SEMESTRAL', label: 'Semestral' },
  { v: 'ANUAL', label: 'Anual' },
] as const;

const METODOS = [
  { v: 'NEQUI', label: 'Nequi' },
  { v: 'TRANSFERENCIA', label: 'Transferencia' },
  { v: 'EFECTIVO', label: 'Efectivo' },
  { v: 'OTRO', label: 'Otro' },
] as const;

const MONEDAS = ['USD', 'COP', 'MXN', 'PEN', 'CLP', 'EUR'];

/** Hoy en Colombia, como «AAAA-MM-DD» para el campo de fecha. */
function hoyEnBogota() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

const VACIO = {
  brandName: '',
  ownerEmail: '',
  ownerPhone: '',
  ownerFullName: '',
  planPeriodicity: '',
  businessType: 'FULL',
  businessCategorySlug: DEFAULT_CATEGORY_SLUG,
  method: '',
  amount: '',
  currency: 'USD',
  paidAt: '',
  reference: '',
  note: '',
};

export default function RegistroDePago() {
  const { token } = useParams<{ token: string }>();
  const [enlace, setEnlace] = useState<Enlace | null>(null);
  const [errorEnlace, setErrorEnlace] = useState<string | null>(null);
  const [form, setForm] = useState({ ...VACIO, paidAt: hoyEnBogota() });
  const [archivo, setArchivo] = useState<File | null>(null);
  const [errores, setErrores] = useState<Errores>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState<string | null>(null);
  const inputArchivo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`${API}/api/public/registro-pago/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.message ?? 'Este enlace no es válido.');
        setEnlace(j);
      })
      .catch((e: Error) => setErrorEnlace(e.message));
  }, [token]);

  const set = (k: keyof typeof VACIO, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrores((e) => {
      if (!e[k]) return e;
      const { [k]: _quitado, ...resto } = e;
      return resto;
    });
  };

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setErrorGeneral(null);
    // Lo que se puede saber sin ir al servidor, se dice antes.
    const faltan: Errores = {};
    if (!form.planPeriodicity) faltan.planPeriodicity = 'Elige la periodicidad del plan.';
    if (!form.method) faltan.method = 'Elige cómo pagó.';
    if (!archivo) faltan.comprobante = 'Sube la foto o el PDF del comprobante.';
    if (Object.keys(faltan).length) {
      setErrores(faltan);
      return;
    }
    setEnviando(true);
    try {
      const datos = new FormData();
      for (const [k, v] of Object.entries(form)) datos.append(k, v);
      datos.append('comprobante', archivo!);
      const r = await fetch(`${API}/api/public/registro-pago/${encodeURIComponent(token)}`, {
        method: 'POST',
        body: datos,
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        if (j?.errores) setErrores(j.errores);
        setErrorGeneral(
          r.status === 429
            ? 'Demasiados envíos seguidos. Espera un minuto y vuelve a intentarlo.'
            : (j?.message ?? 'No se pudo enviar. Revisa tu conexión e inténtalo de nuevo.'),
        );
        return;
      }
      setEnviado(form.brandName.trim());
      setForm({ ...VACIO, paidAt: hoyEnBogota() });
      setArchivo(null);
      setErrores({});
      window.scrollTo({ top: 0 });
    } catch {
      setErrorGeneral('No se pudo enviar. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setEnviando(false);
    }
  }

  if (errorEnlace) {
    return (
      <Marco>
        <div className="card card-pad text-center">
          <div className="text-[15px] font-semibold text-ink">No pudimos abrir el formulario</div>
          <p className="text-mute text-sm mt-1">{errorEnlace}</p>
        </div>
      </Marco>
    );
  }
  if (!enlace) {
    return (
      <Marco>
        <div className="text-mute text-sm text-center py-16">Cargando…</div>
      </Marco>
    );
  }

  if (enviado) {
    return (
      <Marco enlace={enlace}>
        <div className="card card-pad text-center space-y-3">
          <div className="mx-auto w-12 h-12 rounded-full bg-brand/10 text-brand flex items-center justify-center text-2xl">✓</div>
          <div className="text-lg font-bold text-ink">Pago de {enviado} enviado</div>
          <p className="text-mute text-sm max-w-sm mx-auto">
            Quedó pendiente de aprobación. Cuando el equipo confirme que el dinero llegó, se activa el
            negocio y tu comisión queda registrada.
          </p>
          <button type="button" className="btn-primary" onClick={() => setEnviado(null)}>
            Registrar otro pago
          </button>
        </div>
      </Marco>
    );
  }

  return (
    <Marco enlace={enlace}>
      <form onSubmit={enviar} className="space-y-4" noValidate>
        <section className="card card-pad space-y-4">
          <h2 className="text-[15px] font-bold text-ink">El negocio</h2>
          <Campo label="Nombre comercial" error={errores.brandName}>
            <input className="input w-full" value={form.brandName} onChange={(e) => set('brandName', e.target.value)} autoComplete="organization" />
          </Campo>
          <div className="grid sm:grid-cols-2 gap-4">
            <Campo label="Correo del dueño" error={errores.ownerEmail} ayuda="Con este correo entra a su panel.">
              <input className="input w-full" type="email" inputMode="email" value={form.ownerEmail} onChange={(e) => set('ownerEmail', e.target.value)} autoComplete="off" />
            </Campo>
            <Campo label="Teléfono" error={errores.ownerPhone}>
              <PhoneInput value={form.ownerPhone} onChange={(v) => set('ownerPhone', v)} placeholder="3001234567" />
            </Campo>
          </div>
          <Campo label="Nombre del dueño" error={errores.ownerFullName}>
            <input className="input w-full" value={form.ownerFullName} onChange={(e) => set('ownerFullName', e.target.value)} autoComplete="off" />
          </Campo>
          <Campo label="Periodicidad del plan" error={errores.planPeriodicity}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PERIODOS.map((p) => (
                <Opcion key={p.v} activa={form.planPeriodicity === p.v} onClick={() => set('planPeriodicity', p.v)}>
                  {p.label}
                </Opcion>
              ))}
            </div>
          </Campo>
          <div className="grid sm:grid-cols-2 gap-4">
            <Campo label="Categoría del negocio">
              <select className="input w-full" value={form.businessCategorySlug} onChange={(e) => set('businessCategorySlug', e.target.value)}>
                {BUSINESS_CATEGORIES.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.emoji} {c.name}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Producto">
              <div className="grid grid-cols-2 gap-2">
                <Opcion activa={form.businessType === 'FULL'} onClick={() => set('businessType', 'FULL')}>Completo</Opcion>
                <Opcion activa={form.businessType === 'INFOLINK'} onClick={() => set('businessType', 'INFOLINK')}>Solo InfoLink</Opcion>
              </div>
            </Campo>
          </div>
        </section>

        <section className="card card-pad space-y-4">
          <h2 className="text-[15px] font-bold text-ink">El pago</h2>
          <Campo label="¿Cómo pagó?" error={errores.method}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {METODOS.map((m) => (
                <Opcion key={m.v} activa={form.method === m.v} onClick={() => set('method', m.v)}>
                  {m.label}
                </Opcion>
              ))}
            </div>
          </Campo>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Campo label="Monto pagado" error={errores.amount} ayuda="Solo números, sin puntos de miles.">
              <input className="input w-full tabular-nums" inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="150" />
            </Campo>
            <Campo label="Moneda" error={errores.currency}>
              <select className="input" value={form.currency} onChange={(e) => set('currency', e.target.value)}>
                {MONEDAS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </Campo>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Campo label="Fecha del pago" error={errores.paidAt}>
              <input className="input w-full" type="date" value={form.paidAt} max={hoyEnBogota()} onChange={(e) => set('paidAt', e.target.value)} />
            </Campo>
            <Campo label="Referencia o número de comprobante (opcional)" error={errores.reference}>
              <input className="input w-full" value={form.reference} onChange={(e) => set('reference', e.target.value)} />
            </Campo>
          </div>
          <Campo label="Comprobante de pago" error={errores.comprobante}>
            <input
              ref={inputArchivo}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                setArchivo(e.target.files?.[0] ?? null);
                setErrores(({ comprobante: _c, ...resto }) => resto);
              }}
            />
            <button
              type="button"
              onClick={() => inputArchivo.current?.click()}
              className={`w-full rounded-xl border-2 border-dashed px-4 py-5 text-sm text-center transition ${
                archivo ? 'border-brand bg-brand/5 text-ink' : 'border-line text-mute hover:border-brand/60'
              }`}
            >
              {archivo ? (
                <>
                  <span className="font-semibold">{archivo.name}</span>
                  <span className="block text-xs text-mute mt-0.5">Toca para cambiarlo</span>
                </>
              ) : (
                <>Sube la foto o el PDF del comprobante</>
              )}
            </button>
          </Campo>
          <Campo label="Nota para el equipo (opcional)">
            <textarea className="input w-full min-h-[72px]" value={form.note} onChange={(e) => set('note', e.target.value)} />
          </Campo>
        </section>

        {errorGeneral && (
          <div role="alert" className="rounded-xl bg-bad-soft text-bad-ink px-4 py-3 text-sm">
            {errorGeneral}
          </div>
        )}
        <button type="submit" className="btn-primary w-full justify-center h-12 text-[15px]" disabled={enviando}>
          {enviando ? 'Enviando…' : 'Enviar para aprobación'}
        </button>
        <p className="text-center text-xs text-mute pb-6">
          Enviar no activa el negocio: el equipo lo aprueba al confirmar que el pago llegó.
        </p>
      </form>
    </Marco>
  );
}

function Marco({ enlace, children }: { enlace?: Enlace; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-bg px-4 py-8">
      <div className="max-w-xl mx-auto space-y-5">
        {enlace && (
          <header className="flex items-center gap-3">
            {enlace.marca?.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={enlace.marca.logoUrl} alt={enlace.marca.nombre} className="w-11 h-11 rounded-xl object-contain bg-surface border border-line" />
            )}
            <div>
              <h1 className="text-xl font-bold text-ink leading-tight">Registro de pago</h1>
              <p className="text-sm text-mute">
                Closer: <b className="text-ink">{enlace.closer}</b>
              </p>
            </div>
          </header>
        )}
        {children}
      </div>
    </main>
  );
}

function Campo({ label, error, ayuda, children }: { label: string; error?: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
      {error ? (
        <span className="block text-xs text-bad mt-1">{error}</span>
      ) : ayuda ? (
        <span className="block text-xs text-mute mt-1">{ayuda}</span>
      ) : null}
    </div>
  );
}

function Opcion({ activa, onClick, children }: { activa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={`h-10 rounded-xl border text-sm font-semibold transition ${
        activa ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-ink hover:border-brand/60'
      }`}
    >
      {children}
    </button>
  );
}

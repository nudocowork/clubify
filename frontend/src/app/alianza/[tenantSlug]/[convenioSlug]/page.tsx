'use client';
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { PhoneInput } from '@/components/PhoneInput';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Info = {
  negocio: {
    nombre: string;
    logoUrl: string | null;
    color: string | null;
    /** ISO alpha-2. Decide la bandera con la que arranca el teléfono. */
    pais: string | null;
  };
  aliado: { nombre: string; logoUrl: string | null; descripcion: string };
  verificacion: 'ABIERTO' | 'CODIGO' | 'LISTA';
  pide: { codigo: boolean; documento: boolean; politicaDatos: boolean };
  politicaDatosUrl: string;
  cerrado: string | null;
  beneficios: { nombre: string; descripcion: string; resumen: string }[];
};

/**
 * La página del enlace único que la empresa aliada reparte entre sus empleados.
 *
 * Es la pieza que faltaba para que las alianzas existieran: hasta ahora el
 * enlace no llevaba a ninguna parte, así que nadie podía activar nada.
 *
 * NO se pinta ninguna marca hasta que el servidor la resuelve. Poner un
 * «Clubify» de relleno mientras carga delataría la plataforma en la página de
 * una marca blanca, que es la fuga que más veces se ha repetido aquí.
 */
export default function ActivarAlianza() {
  const { tenantSlug, convenioSlug } = useParams<{
    tenantSlug: string;
    convenioSlug: string;
  }>();
  const via = useSearchParams().get('via');

  const [info, setInfo] = useState<Info | null>(null);
  const [noExiste, setNoExiste] = useState(false);
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    documento: '',
    email: '',
    codigo: '',
    acepta: false,
  });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passId, setPassId] = useState<string | null>(null);
  // El enlace de Google Wallet, resuelto EN CUANTO existe el pase.
  //
  // Antes se pedia al pulsar y se navegaba con `window.location.href`. En
  // Android eso NO es un enlace: perdido el gesto del usuario, ni Chrome ni el
  // navegador incrustado de WhatsApp le entregan `pay.google.com/gp/v/save` a
  // la app de Google Wallet, y el boton se quedaba sin hacer nada. En iPhone
  // no se notaba porque el boton de Apple siempre fue un <a> normal.
  const [googleSaveUrl, setGoogleSaveUrl] = useState<string | null>(null);
  const [googleFallo, setGoogleFallo] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/public/alianzas/${tenantSlug}/${convenioSlug}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then(setInfo)
      .catch(() => setNoExiste(true));
  }, [tenantSlug, convenioSlug]);

  useEffect(() => {
    if (!passId) return;
    let vivo = true;
    setGoogleFallo(false);
    fetch(`${API}/api/passes/${passId}/google`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => {
        if (!vivo) return;
        if (d?.saveUrl) setGoogleSaveUrl(d.saveUrl);
        else setGoogleFallo(true);
      })
      .catch(() => {
        if (vivo) setGoogleFallo(true);
      });
    return () => {
      vivo = false;
    };
  }, [passId]);

  async function activar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const r = await fetch(
        `${API}/api/public/alianzas/${tenantSlug}/${convenioSlug}/activar`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName: form.fullName,
            phone: form.phone,
            documento: form.documento,
            email: form.email || undefined,
            codigo: form.codigo || undefined,
            via: via || undefined,
            dataPolicyAccepted: form.acepta,
          }),
        },
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data?.message || 'No pudimos activar tu tarjeta.');
      setPassId(data.passId);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  if (noExiste) {
    return (
      <Marco>
        <p className="text-center text-sm text-neutral-600">
          Este enlace no está disponible.
        </p>
      </Marco>
    );
  }
  // Nada de esqueletos con marca: hasta que no sabemos de quién es la página,
  // no se pinta nada que parezca de nadie.
  if (!info) {
    return (
      <Marco>
        <div className="h-24 animate-pulse rounded-xl bg-neutral-100" />
      </Marco>
    );
  }

  const color = info.negocio.color || '#111111';

  if (passId) {
    return (
      <Marco color={color}>
        <Cabecera info={info} />
        <h1 className="mt-4 text-center text-xl font-semibold">
          ¡Listo, {form.fullName.split(' ')[0]}!
        </h1>
        <p className="mt-2 text-center text-sm text-neutral-600">
          Guarda tu tarjeta en el móvil y enséñala en la caja.
        </p>
        {/* El rescate, dicho antes de que haga falta: si cierra esta pantalla
            no hay forma de reenviarle los botones —no se manda ningún correo—,
            pero volver al mismo enlace con su mismo teléfono le devuelve SU
            tarjeta, no una nueva. Sin esta línea, quien la cierre cree que la
            perdió. */}
        <p className="mt-3 rounded-lg bg-neutral-50 px-3 py-2 text-center text-xs text-neutral-500">
          ¿Cierras sin guardarla? Vuelve a este mismo enlace con tu teléfono y
          te devolvemos tu tarjeta.
        </p>
        <div className="mt-5 grid gap-2">
          <a
            className="rounded-xl px-4 py-3 text-center text-sm font-medium text-white"
            style={{ background: color }}
            href={`${API}/api/passes/${passId}/apple.pkpass`}
          >
            Añadir a Apple Wallet
          </a>
{/* Un <a> de verdad, con el enlace ya resuelto. `/passes/:id/google`
              devuelve `{ saveUrl }` en JSON —por eso no se puede enlazar ese
              endpoint directamente—, pero se pide al cargar y aquí ya está.
              Tiene que ser un enlace: Android solo le entrega el pase a Google
              Wallet cuando la navegación sale de un toque del usuario. */}
          {googleSaveUrl ? (
            <a
              href={googleSaveUrl}
              className="rounded-xl border border-neutral-300 px-4 py-3 text-center text-sm font-medium"
            >
              Añadir a Google Wallet
            </a>
          ) : googleFallo ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              No pudimos preparar la tarjeta para Google Wallet. Recarga la
              página e inténtalo de nuevo.
            </p>
          ) : (
            <span className="rounded-xl border border-neutral-200 px-4 py-3 text-center text-sm font-medium text-neutral-400">
              Preparando Google Wallet…
            </span>
          )}
          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}
        </div>
      </Marco>
    );
  }

  return (
    <Marco color={color}>
      <Cabecera info={info} />

      {info.cerrado ? (
        <p className="mt-6 rounded-xl bg-neutral-50 px-4 py-6 text-center text-sm text-neutral-600">
          {info.cerrado}
        </p>
      ) : (
        <>
          {info.beneficios.length > 0 && (
            <ul className="mt-5 grid gap-2">
              {info.beneficios.map((b, i) => (
                <li
                  key={i}
                  className="rounded-xl border border-neutral-200 px-4 py-3"
                >
                  <p className="text-sm font-medium">{b.resumen}</p>
                  {b.descripcion && (
                    <p className="mt-0.5 text-xs text-neutral-500">{b.descripcion}</p>
                  )}
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={activar} className="mt-6 grid gap-3">
            <Campo
              label="Nombre completo"
              value={form.fullName}
              onChange={(v) => setForm({ ...form, fullName: v })}
              required
            />
            {/* El mismo selector de país con banderas que el resto del
                producto. Escribir el indicativo a mano es el campo que más
                gente escribe mal —«300…» sin país, o «0057»— y el teléfono es
                la llave con la que se recupera la tarjeta después. */}
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">
                Teléfono
              </span>
              <div className="mt-1">
                <PhoneInput
                  value={form.phone}
                  onChange={(v) => setForm({ ...form, phone: v })}
                  defaultCountry={info.negocio.pais ?? undefined}
                  placeholder="300 000 0000"
                />
              </div>
            </label>
            <Campo
              label="Documento de identidad"
              value={form.documento}
              onChange={(v) => setForm({ ...form, documento: v })}
              required
            />
            <Campo
              label="Correo (opcional)"
              value={form.email}
              onChange={(v) => setForm({ ...form, email: v })}
              type="email"
            />
            {info.pide.codigo && (
              <Campo
                label={`Código de ${info.aliado.nombre}`}
                value={form.codigo}
                onChange={(v) => setForm({ ...form, codigo: v })}
                placeholder="El que te dio tu empresa"
                required
              />
            )}

            <label className="mt-1 flex items-start gap-2 text-xs text-neutral-600">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.acepta}
                onChange={(e) => setForm({ ...form, acepta: e.target.checked })}
                required
              />
              <span>
                Acepto la{' '}
                <a
                  className="underline"
                  href={info.politicaDatosUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  política de tratamiento de datos
                </a>
                .
              </span>
            </label>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={enviando}
              className="mt-1 rounded-xl px-4 py-3 text-sm font-medium text-white disabled:opacity-60"
              style={{ background: color }}
            >
              {enviando ? 'Activando…' : 'Activar mi tarjeta'}
            </button>
          </form>
        </>
      )}
    </Marco>
  );
}

function Cabecera({ info }: { info: Info }) {
  return (
    <div className="text-center">
      <div className="flex items-center justify-center gap-3">
        {info.aliado.logoUrl && (
          <img
            src={info.aliado.logoUrl}
            alt={info.aliado.nombre}
            className="h-12 w-12 rounded-xl object-contain"
          />
        )}
        {info.aliado.logoUrl && info.negocio.logoUrl && (
          <span className="text-neutral-300">×</span>
        )}
        {info.negocio.logoUrl && (
          <img
            src={info.negocio.logoUrl}
            alt={info.negocio.nombre}
            className="h-12 w-12 rounded-xl object-contain"
          />
        )}
      </div>
      <p className="mt-3 text-xs uppercase tracking-wide text-neutral-400">
        Convenio con {info.negocio.nombre}
      </p>
      <h1 className="mt-1 text-lg font-semibold">{info.aliado.nombre}</h1>
      {info.aliado.descripcion && (
        <p className="mt-1 text-sm text-neutral-600">{info.aliado.descripcion}</p>
      )}
    </div>
  );
}

function Marco({
  children,
  color,
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-10">
      <div
        className="mx-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-sm"
        style={color ? { borderTop: `4px solid ${color}` } : undefined}
      >
        {children}
      </div>
    </main>
  );
}

function Campo({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-neutral-600">{label}</span>
      <input
        className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-sm outline-none focus:border-neutral-500"
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

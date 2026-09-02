'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

type Portal = {
  negocio: { nombre: string; logoUrl: string | null; color: string | null };
  convenio: {
    nombre: string;
    logoUrl: string | null;
    status: 'ACTIVE' | 'PAUSED' | 'FINISHED';
    endsAt: string | null;
    codigo: string | null;
    verificacion: string;
  };
  soloLectura: boolean;
  motivoGlobal: string | null;
  cupones: {
    id: string;
    nombre: string;
    resumen: string;
    descripcion: string;
    miInterruptor: boolean;
    apagadoPorElNegocio: boolean;
    agotado: boolean;
    vencido: boolean;
    estado: string;
    canjes: number;
  }[];
  informe: {
    tarjetasActivas: number;
    tarjetasBloqueadas: number;
    canjesTotales: number;
    descuentoTotal: number | null;
  };
};

/**
 * El portal de la empresa aliada. Sin cuenta ni contraseña: se entra con el
 * enlace que le pasó el negocio.
 *
 * Puede hacer exactamente tres cosas, y nada más: encender y apagar SUS
 * beneficios, ver un informe con números agregados, y dar de baja a alguien que
 * dejó la empresa escribiendo su documento. No ve ni un nombre ni un teléfono
 * de sus empleados: eso es del negocio, que es quien responde por esos datos.
 */
export default function PortalAliado() {
  const { token } = useParams<{ token: string }>();
  const [p, setP] = useState<Portal | null>(null);
  const [noExiste, setNoExiste] = useState(false);
  const [documento, setDocumento] = useState('');
  const [mensajeBaja, setMensajeBaja] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  /** Qué beneficio falló al cambiar, y por qué. Se pinta junto a él. */
  const [fallo, setFallo] = useState<{ cuponId: string; texto: string } | null>(null);

  const cargar = useCallback(() => {
    fetch(`${API}/api/public/alianzas/portal/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then(setP)
      .catch(() => setNoExiste(true));
  }, [token]);

  useEffect(cargar, [cargar]);

  async function alternar(cuponId: string, activo: boolean) {
    setOcupado(cuponId);
    setFallo(null);
    try {
      const r = await fetch(
        `${API}/api/public/alianzas/portal/${token}/cupones/${cuponId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activo }),
        },
      );
      // Sin esto, un fallo —acuerdo finalizado, enlace rotado, red— recargaba y
      // el interruptor «volvía solo» a su sitio sin decir nada: la empresa se
      // quedaba creyendo que apagó un beneficio que sigue encendido.
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        setFallo({
          cuponId,
          texto: d?.message || 'No pudimos cambiarlo. Inténtalo de nuevo.',
        });
      }
      cargar();
    } catch {
      setFallo({
        cuponId,
        texto: 'No pudimos cambiarlo. Revisa tu conexión e inténtalo otra vez.',
      });
    } finally {
      setOcupado(null);
    }
  }

  async function darDeBaja(e: React.FormEvent) {
    e.preventDefault();
    setOcupado('baja');
    setMensajeBaja(null);
    try {
      const r = await fetch(`${API}/api/public/alianzas/portal/${token}/baja`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documento }),
      });
      const data = await r.json();
      setMensajeBaja(data?.mensaje || data?.message || 'No pudimos procesarlo.');
      if (r.ok) {
        setDocumento('');
        cargar();
      }
    } finally {
      setOcupado(null);
    }
  }

  if (noExiste) {
    return (
      <Marco>
        <p className="text-center text-sm text-neutral-600">
          Este enlace no está disponible. Pídele uno nuevo al negocio.
        </p>
      </Marco>
    );
  }
  if (!p) {
    return (
      <Marco>
        <div className="h-24 animate-pulse rounded-xl bg-neutral-100" />
      </Marco>
    );
  }

  const color = p.negocio.color || '#111111';

  return (
    <Marco color={color} ancho>
      <header className="flex items-center gap-3">
        {p.convenio.logoUrl && (
          <img
            src={p.convenio.logoUrl}
            alt={p.convenio.nombre}
            className="h-11 w-11 rounded-xl object-contain"
          />
        )}
        <div>
          <h1 className="text-lg font-semibold">{p.convenio.nombre}</h1>
          <p className="text-xs text-neutral-500">
            Convenio con {p.negocio.nombre}
          </p>
        </div>
      </header>

      {p.motivoGlobal && (
        <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {/* «Mientras siga así» promete que puede cambiar, y con el acuerdo
              finalizado no puede: es definitivo. */}
          {p.soloLectura
            ? 'Este acuerdo terminó. Tus interruptores ya no tienen efecto y no se puede reabrir.'
            : `${p.motivoGlobal} Mientras siga así, tus interruptores no tienen efecto.`}
        </p>
      )}

      {p.convenio.codigo && (
        <section className="mt-5 rounded-xl border border-neutral-200 p-4">
          <p className="text-xs font-medium text-neutral-500">
            Código para tu gente
          </p>
          <p className="mt-1 font-mono text-xl tracking-wider">
            {p.convenio.codigo}
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            Es lo que se les pide al activar la tarjeta. Si necesitas cambiarlo,
            pídeselo a {p.negocio.nombre}.
          </p>
        </section>
      )}

      {/* ── Los interruptores ── */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold">Beneficios</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          Aquí mandas tú sobre tu interruptor. El negocio tiene el suyo aparte:
          para que un beneficio se pueda usar, los dos tienen que estar
          encendidos.
        </p>
        <ul className="mt-3 grid gap-2">
          {p.cupones.map((c) => (
            <li
              key={c.id}
              className="flex items-start justify-between gap-3 rounded-xl border border-neutral-200 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{c.resumen}</p>
                {c.descripcion && (
                  <p className="mt-0.5 text-xs text-neutral-500">{c.descripcion}</p>
                )}
                <p className="mt-1 text-xs">
                  <Estado texto={c.estado} />
                  <span className="ml-2 text-neutral-400">
                    {c.canjes} {c.canjes === 1 ? 'uso' : 'usos'}
                  </span>
                </p>
                {fallo?.cuponId === c.id && (
                  <p className="mt-1 text-xs font-medium text-red-700">
                    {fallo.texto}
                  </p>
                )}
              </div>
              <button
                type="button"
                disabled={p.soloLectura || ocupado === c.id}
                onClick={() => alternar(c.id, !c.miInterruptor)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                  c.miInterruptor
                    ? 'bg-neutral-900 text-white'
                    : 'border border-neutral-300 text-neutral-600'
                }`}
              >
                {c.miInterruptor ? 'Encendido' : 'Apagado'}
              </button>
            </li>
          ))}
          {p.cupones.length === 0 && (
            <li className="rounded-xl bg-neutral-50 px-4 py-6 text-center text-sm text-neutral-500">
              El negocio todavía no ha cargado beneficios.
            </li>
          )}
        </ul>
      </section>

      {/* ── El informe, solo agregados ── */}
      <section className="mt-7">
        <h2 className="text-sm font-semibold">Cómo va el convenio</h2>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Dato n={p.informe.tarjetasActivas} t="tarjetas activas" />
          <Dato n={p.informe.canjesTotales} t="usos en total" />
          <Dato
            n={
              p.informe.descuentoTotal != null
                ? `$${p.informe.descuentoTotal.toLocaleString('es-CO')}`
                : '—'
            }
            t="ahorro de tu gente"
          />
        </div>
        {p.informe.descuentoTotal == null && (
          <p className="mt-2 text-xs text-neutral-500">
            El ahorro en dinero solo aparece cuando el negocio registra el total
            de la cuenta al aplicar el beneficio.
          </p>
        )}
      </section>

      {/* ── Baja a ciegas ── */}
      {!p.soloLectura && (
        <section className="mt-7 rounded-xl bg-neutral-50 p-4">
          <h2 className="text-sm font-semibold">Alguien dejó la empresa</h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Escribe su documento y le retiramos el beneficio. No podrá volver a
            activarlo.
          </p>
          <form onSubmit={darDeBaja} className="mt-3 flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
              value={documento}
              onChange={(e) => setDocumento(e.target.value)}
              placeholder="Documento de identidad"
              required
            />
            <button
              type="submit"
              disabled={ocupado === 'baja'}
              className="shrink-0 rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Dar de baja
            </button>
          </form>
          {mensajeBaja && (
            <p className="mt-2 text-xs text-neutral-600">{mensajeBaja}</p>
          )}
        </section>
      )}
    </Marco>
  );
}

function Estado({ texto }: { texto: string }) {
  const gris = texto === 'Activo' ? 'text-emerald-700' : 'text-neutral-500';
  return <span className={`font-medium ${gris}`}>{texto}</span>;
}

function Dato({ n, t }: { n: number | string; t: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 px-3 py-3 text-center">
      <p className="text-lg font-semibold">{n}</p>
      <p className="mt-0.5 text-[11px] leading-tight text-neutral-500">{t}</p>
    </div>
  );
}

function Marco({
  children,
  color,
  ancho,
}: {
  children: React.ReactNode;
  color?: string;
  ancho?: boolean;
}) {
  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-10">
      <div
        className={`mx-auto w-full rounded-2xl bg-white p-6 shadow-sm ${
          ancho ? 'max-w-lg' : 'max-w-md'
        }`}
        style={color ? { borderTop: `4px solid ${color}` } : undefined}
      >
        {children}
      </div>
    </main>
  );
}

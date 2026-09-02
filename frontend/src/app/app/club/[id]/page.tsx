'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { plural } from '@/lib/plural';

type Plan = {
  id: string;
  name: string;
  description: string;
  beneficiosPorMes: number;
  unidad: string;
  precioCents: number;
  currency: string;
  isActive: boolean;
  tramos: Array<{ desdeDia: number; hastaDia: number; beneficios: number }>;
};

type Estado = 'ACTIVA' | 'PAUSADA' | 'CANCELADA';

type Miembro = {
  id: string;
  status: Estado;
  periodo: string;
  cupoDelPeriodo: number;
  saldo: number;
  passId: string | null;
  serial: string | null;
  altaEn: string;
  cliente: {
    id: string;
    nombre: string;
    email: string | null;
    telefono: string | null;
  };
};

type ClienteLite = { id: string; fullName: string; email?: string | null; phone?: string | null };

const ETIQUETA: Record<Estado, string> = {
  ACTIVA: 'Al día',
  PAUSADA: 'En pausa',
  CANCELADA: 'De baja',
};

const COLOR: Record<Estado, string> = {
  ACTIVA: 'badge-ok',
  PAUSADA: 'badge-warn',
  CANCELADA: 'badge-mute',
};

export default function SociosDelPlanPage() {
  const params = useParams<{ id: string }>();
  const planId = params?.id as string;

  const [plan, setPlan] = useState<Plan | null>(null);
  const [miembros, setMiembros] = useState<Miembro[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado] = useState<'TODAS' | Estado>('TODAS');
  const [cargando, setCargando] = useState(true);
  const [dandoDeAlta, setDandoDeAlta] = useState(false);

  // Número de petición monotónico para descartar respuestas viejas. El
  // debounce solo cancela el temporizador: una petición YA EN VUELO no se
  // cancela sola. Tecleando «ju» y luego «juan», si la primera tarda más que la
  // segunda, la tabla acababa mostrando los resultados de «ju» con «juan»
  // escrito en la caja. El mismo patrón que en el listado de clientes.
  const peticionRef = useRef(0);

  const cargarMiembros = useCallback(async () => {
    const mia = ++peticionRef.current;
    try {
      const q = new URLSearchParams({ pagina: String(pagina) });
      if (busqueda.trim()) q.set('q', busqueda.trim());
      if (estado !== 'TODAS') q.set('estado', estado);
      const r = await api(`/club/planes/${planId}/miembros?${q}`);
      if (mia !== peticionRef.current) return;
      setMiembros(r.miembros);
      setTotal(r.total);
    } catch (e: any) {
      if (mia !== peticionRef.current) return;
      toast(e.message || 'No se pudieron cargar los socios.', 'error');
    } finally {
      if (mia === peticionRef.current) setCargando(false);
    }
  }, [planId, pagina, busqueda, estado]);

  useEffect(() => {
    // No hay endpoint de un plan suelto: la lista es corta y trae los tramos.
    api('/club/planes')
      .then((ps: Plan[]) => setPlan(ps.find((p) => p.id === planId) ?? null))
      .catch(() => setPlan(null));
  }, [planId]);

  useEffect(() => {
    const t = setTimeout(cargarMiembros, 300);
    return () => clearTimeout(t);
  }, [cargarMiembros]);

  // Volver a la página 1 al cambiar el filtro: quedarse en la 4 de un listado
  // que ahora tiene una sola página muestra un vacío que parece un error.
  useEffect(() => {
    setPagina(1);
  }, [busqueda, estado]);

  async function cambiarEstado(m: Miembro, nuevo: Estado) {
    if (nuevo === 'CANCELADA' && !confirm(`¿Dar de baja a ${m.cliente.nombre}?`)) return;
    try {
      await api(`/club/membresias/${m.id}/estado`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nuevo }),
      });
      toast(
        nuevo === 'ACTIVA'
          ? 'Reactivado. Vuelve a consumir su cupo.'
          : nuevo === 'PAUSADA'
            ? 'En pausa. No podrá consumir hasta que lo reactives.'
            : 'Dado de baja.',
        'success',
      );
      cargarMiembros();
    } catch (e: any) {
      toast(e.message || 'No se pudo cambiar el estado.', 'error');
    }
  }

  /**
   * Copia el enlace con el que el socio instala su tarjeta.
   *
   * El pase se emite en el alta, pero hasta que el cliente lo instala no lo
   * tiene en el móvil. Sin esto, el negocio daba de alta a alguien y se
   * quedaba sin forma de entregársela.
   */
  async function copiarEnlace(m: Miembro) {
    if (!m.passId) return;
    const url = `${window.location.origin}/w/${m.passId}`;
    try {
      await navigator.clipboard.writeText(url);
      toast('Enlace copiado. Envíaselo por WhatsApp.', 'success');
    } catch {
      // Sin permiso de portapapeles (Safari en http, sobre todo): se abre y
      // que copie de la barra. Peor sería no dar ninguna salida.
      window.open(url, '_blank');
    }
  }

  /** Un socio de baja no se reactiva con el interruptor: vuelve a entrar. */
  async function readmitir(m: Miembro) {
    try {
      await api(`/club/planes/${planId}/miembros/${m.cliente.id}`, { method: 'POST' });
      toast('Vuelve a estar dentro, con el cupo que le toca por hoy.', 'success');
      cargarMiembros();
    } catch (e: any) {
      toast(e.message || 'No se pudo readmitir.', 'error');
    }
  }

  const paginas = Math.max(1, Math.ceil(total / 50));

  return (
    <div>
      <Link
        href="/app/club"
        className="text-xs text-mute hover:text-brand inline-flex items-center gap-1 mb-2"
      >
        ← Planes de club
      </Link>

      <div className="page-head">
        <h1 className="page-title">
          {plan?.name ?? 'Socios'}{' '}
          <span className="page-crumb">
            {total === 1 ? '1 socio' : `${total} socios`}
          </span>
        </h1>
        <button
          className="btn-primary"
          onClick={() => setDandoDeAlta(true)}
          disabled={plan ? !plan.isActive : true}
          title={plan && !plan.isActive ? 'El plan está apagado' : undefined}
        >
          <Icon name="plus" /> Dar de alta
        </button>
      </div>

      {plan && (
        <div className="card card-pad mb-4 flex flex-wrap items-center gap-x-8 gap-y-3">
          <Dato
            valor={String(plan.beneficiosPorMes)}
            etiqueta={`${plural(plan.unidad, plan.beneficiosPorMes)} al mes`}
          />
          <Dato
            valor={plan.precioCents ? `$${plan.precioCents.toLocaleString('es-CO')}` : '—'}
            etiqueta="lo que te paga al mes"
          />
          <Dato
            valor={plan.tramos.length ? String(plan.tramos.length) : '—'}
            etiqueta="tramos de alta"
          />
          {!plan.isActive && (
            <span className="badge badge-mute">
              Plan apagado — no se puede dar de alta a nadie nuevo
            </span>
          )}
        </div>
      )}

      {dandoDeAlta && plan && (
        <BuscadorDeCliente
          planId={planId}
          onCerrar={() => setDandoDeAlta(false)}
          onAlta={() => {
            setDandoDeAlta(false);
            cargarMiembros();
          }}
        />
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        <input
          className="input flex-1 min-w-[200px]"
          placeholder="Buscar por nombre, correo o teléfono…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <select
          className="input w-auto"
          value={estado}
          onChange={(e) => setEstado(e.target.value as 'TODAS' | Estado)}
        >
          <option value="TODAS">Todos</option>
          <option value="ACTIVA">Al día</option>
          <option value="PAUSADA">En pausa</option>
          <option value="CANCELADA">De baja</option>
        </select>
      </div>

      {!cargando && miembros.length === 0 && (
        <div className="card card-pad text-center py-10">
          <div className="font-semibold">
            {busqueda || estado !== 'TODAS'
              ? 'Ningún socio con ese filtro'
              : 'Este plan todavía no tiene socios'}
          </div>
          <p className="text-sm text-mute mt-1.5 max-w-md mx-auto">
            {busqueda || estado !== 'TODAS'
              ? 'Prueba a quitar el filtro.'
              : 'Cobra la suscripción por tu medio de siempre y luego da de alta al cliente aquí. Recibirá su tarjeta para la billetera del móvil.'}
          </p>
        </div>
      )}

      {miembros.length > 0 && (
        <div className="card table-wrap">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-mute border-b border-line">
                <th className="p-3 font-medium">Socio</th>
                <th className="p-3 font-medium">Le queda este mes</th>
                <th className="p-3 font-medium">Estado</th>
                <th className="p-3 font-medium">Desde</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {miembros.map((m) => (
                <tr key={m.id} className="border-b border-line last:border-0">
                  <td className="p-3">
                    <Link
                      href={`/app/customers/${m.cliente.id}`}
                      className="font-medium hover:text-brand"
                    >
                      {m.cliente.nombre}
                    </Link>
                    <div className="text-xs text-mute">
                      {m.cliente.email || m.cliente.telefono || '—'}
                    </div>
                    {!m.passId && (
                      <div className="text-xs text-warn-ink mt-0.5">
                        Sin tarjeta emitida
                      </div>
                    )}
                  </td>
                  <td className="p-3 tabular-nums whitespace-nowrap">
                    <strong>{m.saldo}</strong>
                    <span className="text-mute"> de {m.cupoDelPeriodo}</span>
                    <div className="text-xs text-mute">{m.periodo}</div>
                  </td>
                  <td className="p-3">
                    <span className={`badge ${COLOR[m.status]}`}>{ETIQUETA[m.status]}</span>
                  </td>
                  <td className="p-3 text-xs text-mute whitespace-nowrap">
                    {new Date(m.altaEn).toLocaleDateString('es-CO')}
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    {m.status === 'ACTIVA' && (
                      <>
                        <button
                          className="btn-ghost"
                          onClick={() => cambiarEstado(m, 'PAUSADA')}
                        >
                          Pausar
                        </button>
                        <button
                          className="btn-ghost"
                          onClick={() => cambiarEstado(m, 'CANCELADA')}
                        >
                          Dar de baja
                        </button>
                      </>
                    )}
                    {m.status === 'PAUSADA' && (
                      <>
                        <button
                          className="btn-ghost"
                          onClick={() => cambiarEstado(m, 'ACTIVA')}
                        >
                          Reactivar
                        </button>
                        <button
                          className="btn-ghost"
                          onClick={() => cambiarEstado(m, 'CANCELADA')}
                        >
                          Dar de baja
                        </button>
                      </>
                    )}
                    {m.status === 'CANCELADA' && (
                      <button
                        className="btn-ghost"
                        // Readmitir pasa por el alta, que rechaza los planes
                        // apagados. Ofrecerlo y que falle se lee como que el
                        // panel está roto.
                        disabled={!plan?.isActive}
                        title={
                          plan?.isActive
                            ? undefined
                            : 'Enciende el plan para poder readmitir'
                        }
                        onClick={() => readmitir(m)}
                      >
                        Volver a dar de alta
                      </button>
                    )}
                    {m.passId && m.status !== 'CANCELADA' && (
                      <button
                        className="btn-ghost"
                        title="Copiar el enlace para que instale su tarjeta"
                        onClick={() => copiarEnlace(m)}
                      >
                        Enlace
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {paginas > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4 text-sm">
          <button
            className="btn-ghost"
            disabled={pagina <= 1}
            onClick={() => setPagina((p) => p - 1)}
          >
            Anterior
          </button>
          <span className="text-mute tabular-nums">
            {pagina} de {paginas}
          </span>
          <button
            className="btn-ghost"
            disabled={pagina >= paginas}
            onClick={() => setPagina((p) => p + 1)}
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}

function Dato({ valor, etiqueta }: { valor: string; etiqueta: string }) {
  return (
    <div>
      <div className="text-xl font-semibold tabular-nums">{valor}</div>
      <div className="text-xs text-mute">{etiqueta}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════

function BuscadorDeCliente({
  planId,
  onCerrar,
  onAlta,
}: {
  planId: string;
  onCerrar: () => void;
  onAlta: () => void;
}) {
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<ClienteLite[]>([]);
  const [dando, setDando] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResultados([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r: ClienteLite[] = await api(
          `/customers?search=${encodeURIComponent(q.trim())}`,
        );
        setResultados(r.slice(0, 8));
      } catch {
        setResultados([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  async function alta(c: ClienteLite) {
    setDando(c.id);
    try {
      const r = await api(`/club/planes/${planId}/miembros/${c.id}`, { method: 'POST' });
      // El backend devuelve la membresía existente si ya estaba dentro, sin
      // tocar nada. Decirle «entra con 7» al negocio en ese caso le hacía creer
      // que acababa de dar de alta a alguien que ya llevaba meses.
      const yaEstaba = new Date(r.createdAt).getTime() < Date.now() - 10_000;
      toast(
        yaEstaba
          ? `${c.fullName} ya era socio: le quedan ${r.saldo} este mes.`
          : `${c.fullName} entra con ${r.saldo} este mes.`,
        'success',
      );
      onAlta();
    } catch (e: any) {
      toast(e.message || 'No se pudo dar de alta.', 'error');
    } finally {
      setDando(null);
    }
  }

  return (
    <div className="card card-pad mb-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold m-0">Dar de alta a un socio</h2>
          <p className="text-xs text-mute mt-1">
            Búscalo entre tus clientes. Si entra a mitad de mes recibe lo que
            digan tus tramos; del mes siguiente en adelante, el cupo completo.
          </p>
        </div>
        <button className="btn-ghost shrink-0" onClick={onCerrar}>
          Cerrar
        </button>
      </div>

      <input
        className="input mt-3"
        autoFocus
        placeholder="Nombre, correo o teléfono del cliente…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {q.trim().length >= 2 && resultados.length === 0 && (
        <p className="text-sm text-mute mt-3">
          Ningún cliente con ese dato.{' '}
          <Link href="/app/customers" className="text-brand">
            Créalo primero en Clientes
          </Link>
          .
        </p>
      )}

      {resultados.length > 0 && (
        <div className="mt-3 divide-y divide-line">
          {resultados.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{c.fullName}</div>
                <div className="text-xs text-mute truncate">
                  {c.email || c.phone || '—'}
                </div>
              </div>
              <button
                className="btn-primary shrink-0"
                onClick={() => alta(c)}
                disabled={dando === c.id}
              >
                {dando === c.id ? 'Dando de alta…' : 'Dar de alta'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

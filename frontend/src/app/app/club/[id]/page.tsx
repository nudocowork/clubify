'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { plural } from '@/lib/plural';
import { Consumos } from './Consumos';
import {
  EntregarTarjeta,
  type SocioParaEntregar,
} from './EntregarTarjeta';

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
  miembrosActivos: number;
  miembrosPausados: number;
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
  instaladaEn: string | null;
  plataforma: string | null;
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
  const [cerrando, setCerrando] = useState(false);
  // A quién hay que entregarle la tarjeta ahora mismo. Se abre solo al dar
  // de alta, y también desde el botón «Enlace» de cualquier socio.
  const [entregando, setEntregando] = useState<SocioParaEntregar | null>(null);
  const [sociosAlDia, setSociosAlDia] = useState(0);
  const [sociosEnPausa, setSociosEnPausa] = useState(0);

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

  // No hay endpoint de un plan suelto: la lista es corta y trae los tramos y
  // los contadores de socios ya calculados.
  const recargarPlan = useCallback(() => {
    api('/club/planes')
      .then((ps: Plan[]) => {
        const p = ps.find((x) => x.id === planId) ?? null;
        setPlan(p);
        setSociosAlDia(p?.miembrosActivos ?? 0);
        setSociosEnPausa(p?.miembrosPausados ?? 0);
      })
      .catch(() => setPlan(null));
  }, [planId]);

  useEffect(() => {
    recargarPlan();
  }, [recargarPlan]);

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

  /**
   * Da de baja a todos de una vez. Es la salida para cerrar el club: sin esto,
   * la única forma era entrar socio por socio.
   */
  async function cerrarElClub() {
    const cuantos = sociosAlDia + sociosEnPausa;
    if (
      !confirm(
        `Se va a dar de baja a ${cuantos} ${cuantos === 1 ? 'socio' : 'socios'}. Dejarán de consumir y su tarjeta lo dirá. ¿Seguimos?`,
      )
    ) {
      return;
    }
    setCerrando(true);
    try {
      const r = await api(`/club/planes/${planId}/dar-de-baja-a-todos`, {
        method: 'POST',
      });
      toast(
        `${r.dadasDeBaja} ${r.dadasDeBaja === 1 ? 'socio dado' : 'socios dados'} de baja.`,
        'success',
      );
      cargarMiembros();
      recargarPlan();
    } catch (e: any) {
      toast(e.message || 'No se pudo cerrar el club.', 'error');
    } finally {
      setCerrando(false);
    }
  }

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

      {entregando && (
        <EntregarTarjeta
          socio={entregando}
          plan={plan?.name ?? 'tu club'}
          onCerrar={() => setEntregando(null)}
        />
      )}

      {dandoDeAlta && plan && (
        <BuscadorDeCliente
          planId={planId}
          onCerrar={() => setDandoDeAlta(false)}
          onAlta={(socio) => {
            setDandoDeAlta(false);
            // Lo primero que ve el negocio tras el alta es CÓMO entregarla:
            // el pase existe, pero hasta que el cliente abre su enlace no lo
            // tiene en el móvil. Antes esto se quedaba en un aviso que se iba.
            setEntregando(socio);
            cargarMiembros();
            recargarPlan();
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
                    {!m.passId ? (
                      <div className="text-xs text-warn-ink mt-0.5">
                        Sin tarjeta emitida
                      </div>
                    ) : !m.instaladaEn ? (
                      // El dato se guardaba en cada descarga del pase y no lo
                      // leía nadie: el negocio veía a todos sus socios iguales
                      // sin saber cuáles cobraron y nunca llegaron a instalar.
                      <div className="text-xs text-warn-ink mt-0.5">
                        Aún no la ha instalado
                      </div>
                    ) : null}
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
                        title="Ver el QR y el enlace de su tarjeta"
                        onClick={() =>
                          setEntregando({
                            passId: m.passId!,
                            nombre: m.cliente.nombre,
                            telefono: m.cliente.telefono,
                          })
                        }
                      >
                        Su tarjeta
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {plan && <Consumos planId={planId} socios={sociosAlDia} />}

      {plan && (
        <div className="card card-pad mt-4">
          <h2 className="text-base font-semibold m-0">Cerrar el club</h2>
          <p className="text-xs text-mute mt-1 max-w-2xl">
            Apagar el plan solo cierra las altas nuevas: a los socios que ya
            están dentro se les sigue repartiendo su cupo cada mes, que es lo
            correcto mientras te paguen. Si vas a cerrar el club de verdad,
            dales de baja aquí. No se borra nada: conservan su historial y
            puedes readmitirlos cuando quieras.
          </p>
          <button
            className="btn-ghost mt-3"
            disabled={sociosAlDia + sociosEnPausa === 0 || cerrando}
            onClick={cerrarElClub}
          >
            {cerrando
              ? 'Dando de baja…'
              : `Dar de baja a los ${sociosAlDia + sociosEnPausa} socios`}
          </button>
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

/**
 * Dar de alta a un socio: un dato y ya.
 *
 * Antes había que buscarlo entre los clientes existentes y, si no estaba,
 * rellenar un formulario aparte. Eso invertía el caso normal: alguien acaba de
 * pagar en el mostrador y todavía no existe en el sistema. Ahora se escribe lo
 * que se tenga —el teléfono, o el nombre— y el backend resuelve el resto:
 * reutiliza al cliente si ya lo tienes, lo crea si no, y devuelve el pase.
 *
 * Solo pregunta cuando hay varios que encajan, porque dar de alta al que no era
 * es peor que un clic de más.
 *
 * No existe un enlace público del plan a propósito: el club se PAGA, y un
 * enlace que cualquiera pudiera abrir lo convertiría en un regalo. El alta la
 * hace quien sabe que le pagaron, y de ahí sale el QR de ese socio.
 */
function BuscadorDeCliente({
  planId,
  onCerrar,
  onAlta,
}: {
  planId: string;
  onCerrar: () => void;
  onAlta: (socio: SocioParaEntregar) => void;
}) {
  const [dato, setDato] = useState('');
  const [dando, setDando] = useState(false);
  const [ambiguos, setAmbiguos] = useState<ClienteLite[] | null>(null);

  async function darDeAlta(customerId?: string) {
    const texto = dato.trim();
    if (!customerId && texto.length < 2) {
      toast('Escribe el teléfono o el nombre del socio.', 'error');
      return;
    }
    setDando(true);
    try {
      const r = customerId
        ? await api(`/club/planes/${planId}/miembros/${customerId}`, {
            method: 'POST',
          })
        : await api(`/club/planes/${planId}/alta-rapida`, {
            method: 'POST',
            body: JSON.stringify({ identificador: texto }),
          });

      // Varios clientes encajan con lo escrito: que elija el negocio.
      if (r.ambiguos) {
        setAmbiguos(r.ambiguos);
        return;
      }

      const cliente =
        r.cliente ?? ambiguos?.find((c) => c.id === customerId) ?? null;
      onAlta({
        passId: r.passId,
        nombre: cliente?.fullName ?? texto,
        telefono: cliente?.phone ?? null,
      });
    } catch (e: any) {
      toast(e.message || 'No se pudo dar de alta.', 'error');
    } finally {
      setDando(false);
    }
  }

  return (
    <div className="card card-pad mb-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold m-0">Dar de alta a un socio</h2>
          <p className="text-xs text-mute mt-1 max-w-xl">
            Escribe su teléfono, o su nombre si no lo tienes. Si ya es cliente
            tuyo lo reutilizamos; si no, lo creamos. Al terminar te damos el QR
            para que instale su tarjeta.
          </p>
        </div>
        <button className="btn-ghost shrink-0" onClick={onCerrar}>
          Cerrar
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        <input
          className="input flex-1 min-w-[220px]"
          autoFocus
          placeholder="Teléfono o nombre del socio…"
          value={dato}
          onChange={(e) => {
            setDato(e.target.value);
            setAmbiguos(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !dando) void darDeAlta();
          }}
        />
        <button
          className="btn-primary shrink-0"
          onClick={() => darDeAlta()}
          disabled={dando}
        >
          {dando ? 'Dando de alta…' : 'Dar de alta y generar QR'}
        </button>
      </div>

      {ambiguos && ambiguos.length > 0 && (
        <div className="mt-3">
          <div className="text-sm font-medium">
            Tienes varios clientes que encajan. ¿Cuál es?
          </div>
          <div className="mt-2 divide-y divide-line">
            {ambiguos.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{c.fullName}</div>
                  <div className="text-xs text-mute truncate">
                    {c.email || c.phone || 'Sin correo ni teléfono'}
                  </div>
                </div>
                <button
                  className="btn-ghost shrink-0"
                  disabled={dando}
                  onClick={() => darDeAlta(c.id)}
                >
                  Es este
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

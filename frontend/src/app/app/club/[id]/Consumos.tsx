'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { plural } from '@/lib/plural';

type Consumo = {
  id: string;
  cantidad: number;
  saldoResultante: number;
  cuando: string;
  anuladoEn: string | null;
  membresiaId: string;
  cliente: { id: string; nombre: string };
};

type Respuesta = {
  periodo: string;
  total: number;
  pagina: number;
  porPagina: number;
  entregadas: number;
  unidad: string;
  precioCents: number;
  currency: string;
  consumos: Consumo[];
};

/** Los últimos doce meses, del actual hacia atrás. */
function periodosRecientes(): string[] {
  const hoy = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function mesLegible(periodo: string) {
  const [a, m] = periodo.split('-');
  return `${MESES[Number(m) - 1] ?? periodo} de ${a}`;
}

/**
 * El historial de consumos del plan.
 *
 * `ClubConsumo` se escribía desde el primer día y no lo leía nadie: el negocio
 * no podía ver qué se llevó cada socio, ni cruzar lo que cobra contra lo que
 * entrega —que es LA pregunta de una suscripción—, ni deshacer un consumo
 * pasado el momento del escaneo.
 */
export function Consumos({
  planId,
  socios,
}: {
  planId: string;
  /** Cuántos socios al día tiene el plan, para el promedio por persona. */
  socios: number;
}) {
  const [periodo, setPeriodo] = useState(periodosRecientes()[0]);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [anulando, setAnulando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setDatos(await api(`/club/planes/${planId}/consumos?periodo=${periodo}`));
    } catch (e: any) {
      toast(e.message || 'No se pudo cargar el historial.', 'error');
    } finally {
      setCargando(false);
    }
  }, [planId, periodo]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function anular(c: Consumo) {
    if (!confirm(`¿Devolverle este consumo a ${c.cliente.nombre}?`)) return;
    setAnulando(c.id);
    try {
      const r = await api(`/club/caja/anular/${c.id}`, { method: 'POST' });
      toast(
        r.devuelto > 0
          ? 'Devuelto. Su tarjeta ya lo refleja.'
          : 'Es de un mes anterior: devolverlo ahora saldría del cupo de este mes, así que no se toca.',
        r.devuelto > 0 ? 'success' : 'error',
      );
      cargar();
    } catch (e: any) {
      toast(e.message || 'No se pudo deshacer.', 'error');
    } finally {
      setAnulando(null);
    }
  }

  const entregadas = datos?.entregadas ?? 0;
  const unidad = datos?.unidad ?? 'beneficio';
  // Lo que el negocio cobra al mes por los socios que tiene. No se calcula la
  // rentabilidad: el coste de un café lo sabe él, no nosotros, e inventarlo
  // sería peor que no decir nada.
  const cobrado = (datos?.precioCents ?? 0) * socios;

  return (
    <div className="card card-pad mt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold m-0">Consumos</h2>
          <p className="text-xs text-mute mt-1">
            Lo que se han llevado tus socios. Aquí puedes deshacer un consumo
            mal registrado del mes en curso.
          </p>
        </div>
        <select
          className="input w-auto"
          value={periodo}
          onChange={(e) => setPeriodo(e.target.value)}
        >
          {periodosRecientes().map((p) => (
            <option key={p} value={p}>
              {mesLegible(p)}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3">
        <div>
          <div className="text-xl font-semibold tabular-nums">{entregadas}</div>
          <div className="text-xs text-mute">
            {plural(unidad, entregadas)} entregados
          </div>
        </div>
        <div>
          <div className="text-xl font-semibold tabular-nums">
            {socios > 0 ? (entregadas / socios).toFixed(1) : '—'}
          </div>
          <div className="text-xs text-mute">por socio</div>
        </div>
        {cobrado > 0 && (
          <div>
            <div className="text-xl font-semibold tabular-nums">
              ${cobrado.toLocaleString('es-CO')}
            </div>
            <div className="text-xs text-mute">
              cobrado este mes por {socios} {socios === 1 ? 'socio' : 'socios'}
            </div>
          </div>
        )}
      </div>

      {!cargando && datos && datos.consumos.length === 0 && (
        <p className="text-sm text-mute mt-4">
          Nadie consumió nada en {mesLegible(periodo)}.
        </p>
      )}

      {datos && datos.consumos.length > 0 && (
        <div className="table-wrap mt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-mute border-b border-line">
                <th className="p-2 font-medium">Socio</th>
                <th className="p-2 font-medium">Se llevó</th>
                <th className="p-2 font-medium">Le quedaron</th>
                <th className="p-2 font-medium">Cuándo</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {datos.consumos.map((c) => (
                <tr
                  key={c.id}
                  className={`border-b border-line last:border-0 ${
                    c.anuladoEn ? 'text-mute' : ''
                  }`}
                >
                  <td className="p-2">{c.cliente.nombre}</td>
                  <td className="p-2 tabular-nums whitespace-nowrap">
                    {c.cantidad} {plural(unidad, c.cantidad)}
                    {c.anuladoEn && (
                      <span className="badge badge-mute ml-2">Devuelto</span>
                    )}
                  </td>
                  <td className="p-2 tabular-nums">{c.saldoResultante}</td>
                  <td className="p-2 text-xs whitespace-nowrap">
                    {new Date(c.cuando).toLocaleString('es-CO', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="p-2 text-right">
                    {!c.anuladoEn && (
                      <button
                        className="btn-ghost"
                        disabled={anulando === c.id}
                        onClick={() => anular(c)}
                      >
                        {anulando === c.id ? 'Deshaciendo…' : 'Deshacer'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {datos && datos.total > datos.consumos.length && (
        <p className="text-xs text-mute mt-3">
          Se muestran los {datos.consumos.length} más recientes de {datos.total}.
        </p>
      )}
    </div>
  );
}

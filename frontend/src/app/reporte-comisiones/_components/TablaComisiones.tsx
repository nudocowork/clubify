'use client';
import { badgeDeEstado, fecha, usd, type Fila } from '../_lib';

/**
 * Tabla de comisiones con scroll horizontal PROPIO: en el celular la página no
 * se desborda, se desliza la tabla.
 */
export function TablaComisiones({
  filas,
  onDescripcion,
  mostrarColaborador = true,
  vacio = 'No hay comisiones con estos filtros.',
}: {
  filas: Fila[];
  onDescripcion: (id: string) => void;
  mostrarColaborador?: boolean;
  vacio?: string;
}) {
  if (filas.length === 0) return <p className="text-sm text-mute py-6 text-center">{vacio}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-line2">
      <table className="min-w-[1100px] w-full text-sm">
        <thead className="bg-bg2 text-[11px] uppercase tracking-wide text-mute">
          <tr>
            <th className="text-left px-3 py-2 font-semibold">Fecha</th>
            {mostrarColaborador && <th className="text-left px-3 py-2 font-semibold">Colaborador</th>}
            <th className="text-left px-3 py-2 font-semibold">Negocio</th>
            <th className="text-left px-3 py-2 font-semibold">Cliente</th>
            <th className="text-left px-3 py-2 font-semibold">Plan</th>
            <th className="text-left px-3 py-2 font-semibold">Tipo</th>
            <th className="text-right px-3 py-2 font-semibold">Venta</th>
            <th className="text-right px-3 py-2 font-semibold">% / fijo</th>
            <th className="text-right px-3 py-2 font-semibold">Comisión</th>
            <th className="text-left px-3 py-2 font-semibold">Próx. renovación</th>
            <th className="text-left px-3 py-2 font-semibold">Pago del cliente</th>
            <th className="text-left px-3 py-2 font-semibold">Estado</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id} className="border-t border-line2 align-top hover:bg-bg2/50">
              <td className="px-3 py-2 whitespace-nowrap">{fecha(f.fecha)}</td>
              {mostrarColaborador && (
                <td className="px-3 py-2">
                  <div className="font-medium text-ink">{f.colaborador.nombre}</div>
                  <div className="text-[11px] text-mute">{f.colaborador.rolEtiqueta}</div>
                </td>
              )}
              <td className="px-3 py-2">
                {f.negocio.nombre ?? <span className="text-mute">—</span>}
                {f.negocio.esGrupo && <span className="badge badge-mute ml-1">Grupo</span>}
              </td>
              <td className="px-3 py-2">{f.cliente ?? <span className="text-mute">—</span>}</td>
              <td className="px-3 py-2 whitespace-nowrap">{f.plan ?? <span className="text-mute">—</span>}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                {f.esDeEquipo
                  ? 'Comisión de equipo'
                  : f.esManual
                    ? `Manual${f.tipoManual ? ` · ${f.tipoManual}` : ''}`
                    : (f.tipoVentaEtiqueta ?? '—')}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">{usd(f.ventaUsd)}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                {f.porcentaje != null && !f.esFijo ? `${f.porcentaje}%` : 'Fijo'}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap font-semibold">
                {usd(f.montoUsd)}
                {f.pagadoUsd > 0 && f.pagadoUsd < f.montoUsd && (
                  <div className="text-[11px] font-normal text-mute">pagado {usd(f.pagadoUsd)}</div>
                )}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{fecha(f.proximaRenovacion)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{f.estadoCliente}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <span className={`badge ${badgeDeEstado(f.estado)}`}>{f.estadoEtiqueta}</span>
                {f.corte && <div className="text-[11px] text-mute mt-1">{f.corte.code}</div>}
              </td>
              <td className="px-3 py-2 text-right">
                <button className="btn-link text-xs whitespace-nowrap" onClick={() => onDescripcion(f.id)}>
                  Ver descripción
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

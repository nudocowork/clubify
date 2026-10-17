'use client';
/**
 * Pestaña «Reglas» de /admin/commissions.
 *
 *  · Participaciones globales: «X cobra Y sobre las ventas de Clubify»,
 *    ADICIONAL a la comisión de quien vendió (socio comercial, PM…).
 *  · Reglas por colaborador: fija, distinta para nueva o renovación, por
 *    periodicidad, con vigencia. Por encima del % del código y por debajo de la
 *    excepción por cliente.
 *
 * Todo cambio pide un MOTIVO y queda en el historial (quién, cuándo, antes y
 * después). Ninguna regla toca comisiones ya creadas: lo dice la pantalla
 * porque es la pregunta que se hace cualquiera antes de subir un %.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';

type Codigo = {
  id: string;
  code: string;
  ownerName: string;
  ownerEmail: string;
  role: string;
  isActive?: boolean;
  commissionPercent?: number | string;
};

type ReglaBase = {
  id: string;
  nombre: string | null;
  tipo: 'PORCENTAJE' | 'FIJO';
  valor: number;
  aplicaA: 'NUEVAS' | 'RENOVACIONES' | 'AMBAS';
  periodicidades: string[];
  planIds: string[];
  vigenteDesde: string | null;
  vigenteHasta: string | null;
  activo: boolean;
  createdAt: string;
};

type Participacion = ReglaBase & {
  nombre: string;
  beneficiarioCodeId: string;
  beneficiarioCode: Codigo;
  negociosIncluidos: string[];
  negociosExcluidos: string[];
  comisionesGeneradas: number;
};

type ReglaColaborador = ReglaBase & { codeId: string; prioridad: number; code: Codigo };

type Historial = {
  id: string;
  accion: string;
  antes: Record<string, unknown> | null;
  despues: Record<string, unknown> | null;
  motivo: string;
  actorEmail: string | null;
  createdAt: string;
};

type Simulacion = {
  cobrosRevisados: number;
  porRegla: Array<{ reglaId: string; nombre: string; ventas: number; totalUsd: number; yaCreadas: number }>;
  excluidos: Record<string, number>;
};

const PERIODICIDADES = ['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'];
const APLICA: Record<string, string> = {
  AMBAS: 'Nuevas y renovaciones',
  NUEVAS: 'Solo ventas nuevas',
  RENOVACIONES: 'Solo renovaciones',
};
const ROL: Record<string, string> = {
  SOCIO: 'Socio',
  INFLUENCER: 'Influencer',
  AMBASSADOR: 'Embajador',
  VENDOR: 'Vendedor',
};
const EXCLUSION: Record<string, string> = {
  REEMBOLSADA: 'Reembolsadas o canceladas',
  NO_PAGADA: 'En revisión o intermediadas',
  MARCA_BLANCA: 'De una marca blanca',
  NO_ES_VENTA_DE_PLAN: 'No son venta de plan',
  SIN_NEGOCIO: 'Sin negocio identificado',
  SIN_PRECIO_DE_PLAN: 'Sin precio de plan',
};
const ACCION: Record<string, string> = {
  CREADA: 'Creada',
  EDITADA: 'Editada',
  ACTIVADA: 'Activada',
  DESACTIVADA: 'Desactivada',
};

function usd(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Fecha guardada (medianoche de Bogotá en UTC) → AAAA-MM-DD de Bogotá. */
function ymd(iso: string | null, esFin = false): string {
  if (!iso) return '';
  const d = new Date(iso);
  // «Hasta» se guarda como la medianoche SIGUIENTE (exclusiva): se enseña el día anterior.
  if (esFin) d.setTime(d.getTime() - 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

function valorDe(r: Pick<ReglaBase, 'tipo' | 'valor'>) {
  return r.tipo === 'FIJO' ? `${usd(Number(r.valor))} por venta` : `${Number(r.valor)} %`;
}

function vigencia(r: ReglaBase) {
  const d = ymd(r.vigenteDesde);
  const h = ymd(r.vigenteHasta, true);
  if (!d && !h) return 'Desde siempre';
  if (d && !h) return `Desde ${d}`;
  if (!d && h) return `Hasta ${h}`;
  return `${d} → ${h}`;
}

export default function ReglasTab() {
  const [datos, setDatos] = useState<{ participaciones: Participacion[]; colaboradores: ReglaColaborador[] } | null>(null);
  const [cargando, setCargando] = useState(true);
  const [editando, setEditando] = useState<
    { ambito: 'participacion'; regla: Participacion | null } | { ambito: 'colaborador'; regla: ReglaColaborador | null } | null
  >(null);
  const [historial, setHistorial] = useState<{ titulo: string; filas: Historial[] } | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setDatos(await api('/admin/reglas-de-comision'));
    } catch (e: any) {
      toast(e?.message ?? 'No se pudieron cargar las reglas', 'error');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function verHistorial(ambito: 'participaciones' | 'colaboradores', id: string, titulo: string) {
    try {
      const filas = await api<Historial[]>(`/admin/reglas-de-comision/${ambito}/${id}/historial`);
      setHistorial({ titulo, filas });
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo cargar el historial', 'error');
    }
  }

  async function alternar(ambito: 'participaciones' | 'colaboradores', id: string, activo: boolean, nombre: string) {
    const motivo = prompt(
      `${activo ? 'Desactivar' : 'Activar'} «${nombre}». Escribe el motivo (queda en el historial):`,
    );
    if (!motivo) return;
    try {
      await api(`/admin/reglas-de-comision/${ambito}/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ activo: !activo, motivo }),
      });
      toast(activo ? 'Desactivada' : 'Activada', 'success');
      cargar();
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo cambiar', 'error');
    }
  }

  if (cargando && !datos) return <div className="card card-pad text-mute">Cargando reglas…</div>;
  if (!datos) return null;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-line2 bg-bg2 px-4 py-3 text-sm text-mute">
        Las reglas se aplican al <strong className="text-ink">crear</strong> cada comisión. Cambiar un
        porcentaje o desactivar una regla <strong className="text-ink">no modifica</strong> las comisiones que ya
        existen: cada una guarda la base y el porcentaje con que nació.
      </div>

      {/* ── Participaciones globales ── */}
      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-line2">
          <div>
            <h2 className="font-semibold">Participaciones globales</h2>
            <p className="text-xs text-mute">
              Un porcentaje de cada venta confirmada de Clubify, además de la comisión de quien vendió. No aplica a
              ventas de marcas blancas.
            </p>
          </div>
          <button
            onClick={() => setEditando({ ambito: 'participacion', regla: null })}
            className="text-sm px-4 py-2 rounded-md bg-brand text-white font-semibold hover:opacity-90 transition"
          >
            + Nueva participación
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-mute">
                <th className="px-4 py-2">Nombre</th>
                <th className="px-4 py-2">Beneficiario</th>
                <th className="px-4 py-2">Valor</th>
                <th className="px-4 py-2">Aplica a</th>
                <th className="px-4 py-2">Vigencia</th>
                <th className="px-4 py-2 text-right">Comisiones</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {datos.participaciones.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-mute">
                    Todavía no hay participaciones.
                  </td>
                </tr>
              )}
              {datos.participaciones.map((p) => (
                <tr key={p.id} className={`border-t border-line2 ${p.activo ? '' : 'opacity-50'}`}>
                  <td className="px-4 py-2 font-medium">
                    {p.nombre}
                    {!p.activo && <span className="ml-2 badge text-[10px]">Inactiva</span>}
                  </td>
                  <td className="px-4 py-2">
                    {p.beneficiarioCode.ownerName}
                    <div className="text-[11px] text-mute">
                      {ROL[p.beneficiarioCode.role] ?? p.beneficiarioCode.role} · {p.beneficiarioCode.code}
                    </div>
                  </td>
                  <td className="px-4 py-2 font-semibold">{valorDe(p)}</td>
                  <td className="px-4 py-2">
                    {APLICA[p.aplicaA]}
                    {p.periodicidades.length > 0 && (
                      <div className="text-[11px] text-mute">{p.periodicidades.join(', ').toLowerCase()}</div>
                    )}
                  </td>
                  <td className="px-4 py-2">{vigencia(p)}</td>
                  <td className="px-4 py-2 text-right">{p.comisionesGeneradas}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <AccionesFila
                      onEditar={() => setEditando({ ambito: 'participacion', regla: p })}
                      onAlternar={() => alternar('participaciones', p.id, p.activo, p.nombre)}
                      onHistorial={() => verHistorial('participaciones', p.id, p.nombre)}
                      activo={p.activo}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SimuladorDeParticipaciones />
      </section>

      {/* ── Reglas por colaborador ── */}
      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-line2">
          <div>
            <h2 className="font-semibold">Reglas por colaborador</h2>
            <p className="text-xs text-mute">
              Reemplazan el % del código del colaborador en las ventas que cumplan la regla. La excepción por cliente
              sigue ganando. Si varias aplican, gana la de mayor prioridad y, a igualdad, la más específica.
            </p>
          </div>
          <button
            onClick={() => setEditando({ ambito: 'colaborador', regla: null })}
            className="text-sm px-4 py-2 rounded-md bg-brand text-white font-semibold hover:opacity-90 transition"
          >
            + Nueva regla
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-mute">
                <th className="px-4 py-2">Colaborador</th>
                <th className="px-4 py-2">Regla</th>
                <th className="px-4 py-2">Valor</th>
                <th className="px-4 py-2">Aplica a</th>
                <th className="px-4 py-2">Vigencia</th>
                <th className="px-4 py-2 text-right">Prioridad</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {datos.colaboradores.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-mute">
                    Ningún colaborador tiene reglas propias: todos cobran el % de su código.
                  </td>
                </tr>
              )}
              {datos.colaboradores.map((r) => (
                <tr key={r.id} className={`border-t border-line2 ${r.activo ? '' : 'opacity-50'}`}>
                  <td className="px-4 py-2">
                    {r.code.ownerName}
                    <div className="text-[11px] text-mute">
                      {ROL[r.code.role] ?? r.code.role} · {r.code.code} · código al {Number(r.code.commissionPercent)} %
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    {r.nombre || '—'}
                    {!r.activo && <span className="ml-2 badge text-[10px]">Inactiva</span>}
                  </td>
                  <td className="px-4 py-2 font-semibold">{valorDe(r)}</td>
                  <td className="px-4 py-2">
                    {APLICA[r.aplicaA]}
                    {r.periodicidades.length > 0 && (
                      <div className="text-[11px] text-mute">{r.periodicidades.join(', ').toLowerCase()}</div>
                    )}
                  </td>
                  <td className="px-4 py-2">{vigencia(r)}</td>
                  <td className="px-4 py-2 text-right">{r.prioridad}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <AccionesFila
                      onEditar={() => setEditando({ ambito: 'colaborador', regla: r })}
                      onAlternar={() => alternar('colaboradores', r.id, r.activo, r.nombre || r.code.ownerName)}
                      onHistorial={() => verHistorial('colaboradores', r.id, r.nombre || r.code.ownerName)}
                      activo={r.activo}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editando && (
        <FormularioDeRegla
          ambito={editando.ambito}
          regla={editando.regla}
          onClose={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null);
            cargar();
          }}
        />
      )}
      {historial && <VentanaHistorial {...historial} onClose={() => setHistorial(null)} />}
    </div>
  );
}

function AccionesFila(props: { onEditar: () => void; onAlternar: () => void; onHistorial: () => void; activo: boolean }) {
  const btn = 'text-xs px-2.5 py-1 rounded-pill border border-line bg-white font-semibold hover:bg-bg2 transition';
  return (
    <div className="inline-flex gap-1.5">
      <button className={btn} onClick={props.onEditar}>
        Editar
      </button>
      <button className={btn} onClick={props.onAlternar}>
        {props.activo ? 'Desactivar' : 'Activar'}
      </button>
      <button className={btn} onClick={props.onHistorial}>
        Historial
      </button>
    </div>
  );
}

/** Lo que generarían las participaciones activas en un rango. Solo lectura. */
function SimuladorDeParticipaciones() {
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [res, setRes] = useState<Simulacion | null>(null);
  const [corriendo, setCorriendo] = useState(false);

  async function simular() {
    setCorriendo(true);
    try {
      const q = new URLSearchParams();
      if (desde) q.set('desde', desde);
      if (hasta) q.set('hasta', hasta);
      setRes(await api<Simulacion>(`/admin/reglas-de-comision/participaciones/simulacion?${q}`));
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo simular', 'error');
    } finally {
      setCorriendo(false);
    }
  }

  return (
    <div className="border-t border-line2 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-2">
        Simulación sobre cobros (no escribe nada)
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="label">Desde</span>
          <input type="date" className="input" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="label">Hasta</span>
          <input type="date" className="input" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
        <button
          onClick={simular}
          disabled={corriendo}
          className="text-sm px-3.5 py-1.5 rounded-pill border border-line bg-white font-semibold hover:bg-bg2 transition disabled:opacity-50"
        >
          {corriendo ? 'Calculando…' : 'Simular'}
        </button>
      </div>
      {res && (
        <div className="mt-3 text-sm space-y-1">
          <div className="text-xs text-mute">{res.cobrosRevisados} cobros revisados</div>
          {res.porRegla.length === 0 && <div className="text-mute">Ninguna venta del rango participa.</div>}
          {res.porRegla.map((r) => (
            <div key={r.reglaId} className="flex flex-wrap justify-between gap-2">
              <span>{r.nombre}</span>
              <span>
                <strong>{usd(r.totalUsd)}</strong> en {r.ventas} ventas
                {r.yaCreadas > 0 && <span className="text-mute"> · {r.yaCreadas} ya creadas</span>}
              </span>
            </div>
          ))}
          {Object.keys(res.excluidos).length > 0 && (
            <div className="text-[11px] text-mute pt-1">
              Excluidos:{' '}
              {Object.entries(res.excluidos)
                .map(([k, n]) => `${EXCLUSION[k] ?? k} ${n}`)
                .join(' · ')}
            </div>
          )}
          <div className="text-[11px] text-mute">
            El histórico NO se crea desde aquí: lo aplica el script de backfill, que primero simula.
          </div>
        </div>
      )}
    </div>
  );
}

function BuscadorDeCodigo({ value, onChange }: { value: Codigo | null; onChange: (c: Codigo | null) => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Codigo[]>([]);

  useEffect(() => {
    if (value) return;
    const t = setTimeout(async () => {
      try {
        setItems(await api<Codigo[]>(`/admin/reglas-de-comision/codigos?q=${encodeURIComponent(q)}`));
      } catch {
        setItems([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, value]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-line2 px-3 py-2 text-sm">
        <span>
          ✓ {value.ownerName} · {ROL[value.role] ?? value.role} · {value.code}
        </span>
        <button className="text-mute hover:text-ink" onClick={() => onChange(null)} aria-label="Quitar">
          ×
        </button>
      </div>
    );
  }
  return (
    <div>
      <input className="input w-full" placeholder="Nombre, correo o código" value={q} onChange={(e) => setQ(e.target.value)} />
      {items.length > 0 && (
        <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-line2">
          {items.map((c) => (
            <button
              key={c.id}
              className="block w-full text-left px-3 py-1.5 text-sm hover:bg-bg2"
              onClick={() => onChange(c)}
            >
              {c.ownerName} <span className="text-mute">· {ROL[c.role] ?? c.role} · {c.code}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FormularioDeRegla({
  ambito,
  regla,
  onClose,
  onGuardado,
}: {
  ambito: 'participacion' | 'colaborador';
  regla: Participacion | ReglaColaborador | null;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const esParticipacion = ambito === 'participacion';
  const inicial: Codigo | null = regla
    ? esParticipacion
      ? (regla as Participacion).beneficiarioCode
      : (regla as ReglaColaborador).code
    : null;
  const [codigo, setCodigo] = useState<Codigo | null>(inicial);
  const [nombre, setNombre] = useState(regla?.nombre ?? '');
  const [tipo, setTipo] = useState<'PORCENTAJE' | 'FIJO'>(regla?.tipo ?? 'PORCENTAJE');
  const [valor, setValor] = useState(regla ? String(regla.valor) : '');
  const [aplicaA, setAplicaA] = useState(regla?.aplicaA ?? 'AMBAS');
  const [periodicidades, setPeriodicidades] = useState<string[]>(regla?.periodicidades ?? []);
  const [desde, setDesde] = useState(ymd(regla?.vigenteDesde ?? null));
  const [hasta, setHasta] = useState(ymd(regla?.vigenteHasta ?? null, true));
  const [prioridad, setPrioridad] = useState(String((regla as ReglaColaborador | null)?.prioridad ?? 0));
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (!codigo) return toast(esParticipacion ? 'Elige el beneficiario' : 'Elige el colaborador', 'info');
    if (esParticipacion && !nombre.trim()) return toast('Ponle un nombre', 'info');
    const v = Number(valor.replace(',', '.'));
    if (!(v > 0)) return toast('El valor tiene que ser mayor que 0', 'info');
    if (motivo.trim().length < 5) return toast('Escribe el motivo del cambio', 'info');
    const body: Record<string, unknown> = {
      nombre: nombre.trim() || null,
      tipo,
      valor: v,
      aplicaA,
      periodicidades,
      vigenteDesde: desde || null,
      vigenteHasta: hasta || null,
      motivo: motivo.trim(),
    };
    if (!regla) body[esParticipacion ? 'beneficiarioCodeId' : 'codeId'] = codigo.id;
    if (!esParticipacion) body.prioridad = Math.trunc(Number(prioridad) || 0);
    setGuardando(true);
    try {
      const ruta = `/admin/reglas-de-comision/${esParticipacion ? 'participaciones' : 'colaboradores'}`;
      await api(regla ? `${ruta}/${regla.id}` : ruta, {
        method: regla ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      toast('Regla guardada', 'success');
      onGuardado();
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo guardar', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface rounded-xl max-w-lg w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-bold text-lg mb-4">
          {regla ? 'Editar' : 'Nueva'} {esParticipacion ? 'participación global' : 'regla de colaborador'}
        </h3>
        <div className="space-y-3">
          <div>
            <span className="label">{esParticipacion ? 'Beneficiario' : 'Colaborador'}</span>
            {regla ? (
              <div className="text-sm">
                {inicial?.ownerName} · {inicial?.code}
                <div className="text-[11px] text-mute">
                  No se cambia: para otra persona, desactiva esta y crea otra.
                </div>
              </div>
            ) : (
              <BuscadorDeCodigo value={codigo} onChange={setCodigo} />
            )}
          </div>
          <label className="block">
            <span className="label">Nombre{esParticipacion ? '' : ' (opcional)'}</span>
            <input className="input w-full" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </label>
          <div className="flex gap-3">
            <label className="block flex-1">
              <span className="label">Tipo</span>
              <select className="input w-full" value={tipo} onChange={(e) => setTipo(e.target.value as 'PORCENTAJE' | 'FIJO')}>
                <option value="PORCENTAJE">Porcentaje del precio del plan</option>
                <option value="FIJO">Monto fijo por venta (USD)</option>
              </select>
            </label>
            <label className="block w-32">
              <span className="label">{tipo === 'FIJO' ? 'USD' : '%'}</span>
              <input className="input w-full" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="label">Aplica a</span>
            <select className="input w-full" value={aplicaA} onChange={(e) => setAplicaA(e.target.value as ReglaBase['aplicaA'])}>
              {Object.entries(APLICA).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-mute">Un upgrade cuenta como venta nueva.</span>
          </label>
          <div>
            <span className="label">Periodicidad (ninguna marcada = todas)</span>
            <div className="flex flex-wrap gap-2">
              {PERIODICIDADES.map((p) => (
                <label key={p} className="inline-flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={periodicidades.includes(p)}
                    onChange={(e) =>
                      setPeriodicidades((ps) => (e.target.checked ? [...ps, p] : ps.filter((x) => x !== p)))
                    }
                  />
                  {p.charAt(0) + p.slice(1).toLowerCase()}
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <label className="block flex-1">
              <span className="label">Vigente desde</span>
              <input type="date" className="input w-full" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </label>
            <label className="block flex-1">
              <span className="label">Hasta (incluido)</span>
              <input type="date" className="input w-full" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </label>
          </div>
          <div className="text-[11px] text-mute">Sin fechas = desde siempre y sin fin.</div>
          {!esParticipacion && (
            <label className="block w-32">
              <span className="label">Prioridad</span>
              <input className="input w-full" inputMode="numeric" value={prioridad} onChange={(e) => setPrioridad(e.target.value)} />
            </label>
          )}
          <label className="block">
            <span className="label">Motivo del cambio (obligatorio)</span>
            <textarea
              className="input w-full"
              rows={2}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej.: acordado con el dueño el 17-oct"
            />
          </label>
          <div className="rounded-md bg-bg2 px-3 py-2 text-[11px] text-mute">
            Solo afecta a las comisiones que se creen desde ahora. Las existentes conservan su base y su porcentaje.
            {esParticipacion && ' El histórico se aplica aparte, con el script de backfill.'}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-md bg-bg2 hover:bg-bg3 transition">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="text-sm px-4 py-2 rounded-md bg-brand text-white font-semibold hover:opacity-90 transition disabled:opacity-50"
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Campos que se enseñan del antes/después (lo demás es ruido técnico). */
const CAMPOS: Array<[string, string]> = [
  ['nombre', 'Nombre'],
  ['tipo', 'Tipo'],
  ['valor', 'Valor'],
  ['aplicaA', 'Aplica a'],
  ['periodicidades', 'Periodicidad'],
  ['vigenteDesde', 'Desde'],
  ['vigenteHasta', 'Hasta'],
  ['prioridad', 'Prioridad'],
  ['activo', 'Activa'],
];

function mostrar(v: unknown): string {
  if (v == null || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'todas';
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  return String(v);
}

function VentanaHistorial({ titulo, filas, onClose }: { titulo: string; filas: Historial[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-surface rounded-xl max-w-lg w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-bold text-lg mb-4">Historial · {titulo}</h3>
        {filas.length === 0 && <div className="text-mute text-sm">Sin cambios registrados.</div>}
        <div className="space-y-3">
          {filas.map((h) => {
            const cambios = CAMPOS.filter(
              ([k]) => h.antes == null || JSON.stringify(h.antes[k]) !== JSON.stringify(h.despues?.[k]),
            ).filter(([k]) => h.despues && k in h.despues);
            return (
              <div key={h.id} className="rounded-lg border border-line2 p-3 text-sm">
                <div className="flex justify-between gap-2">
                  <strong>{ACCION[h.accion] ?? h.accion}</strong>
                  <span className="text-xs text-mute">
                    {new Date(h.createdAt).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
                  </span>
                </div>
                <div className="text-xs text-mute">{h.actorEmail ?? '—'}</div>
                <div className="mt-1">«{h.motivo}»</div>
                {cambios.length > 0 && (
                  <ul className="mt-2 text-xs space-y-0.5">
                    {cambios.map(([k, etiqueta]) => (
                      <li key={k}>
                        {etiqueta}: {h.antes ? <span className="line-through text-mute">{mostrar(h.antes[k])}</span> : null}
                        {h.antes ? ' → ' : ''}
                        <strong>{mostrar(h.despues?.[k])}</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex justify-end mt-5">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-md bg-bg2 hover:bg-bg3 transition">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

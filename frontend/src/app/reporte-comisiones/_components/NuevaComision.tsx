'use client';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { FileUploader } from '@/components/FileUploader';
import { fecha, nuevaClave, usd } from '../_lib';
import { CampoMotivo, Modal } from './Modal';

export type OpcionColaborador = { codeId: string; nombre: string; code: string; rol: string; activo: boolean; porcentaje: number; etiqueta: string };

type Negocio = { id: string; brandName: string; planPeriodicity: string | null };
type Venta = { id: string; saleDate: string; grossUsd: number; gateway: string; planPeriodicity: string | null; isFirstPayment: boolean; status: string };

const TIPOS = [
  { id: 'VENTA', etiqueta: 'Venta nueva' },
  { id: 'RENOVACION', etiqueta: 'Renovación' },
  { id: 'BONO', etiqueta: 'Bono' },
  { id: 'AJUSTE', etiqueta: 'Ajuste' },
  { id: 'OTRO', etiqueta: 'Otro' },
];

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

/**
 * «+ Nueva comisión». El monto que se ve aquí es solo una vista previa: lo
 * calcula el servidor. La clave se genera al abrir el formulario, así un doble
 * clic o un reintento no crean dos comisiones.
 */
export function NuevaComision({
  colaboradores,
  onCerrar,
  onCreada,
}: {
  colaboradores: OpcionColaborador[];
  onCerrar: () => void;
  onCreada: (commissionId: string) => void;
}) {
  const [clave] = useState(nuevaClave);
  const [dia, setDia] = useState(hoy);
  const [codeId, setCodeId] = useState('');
  const [buscaColab, setBuscaColab] = useState('');
  const [negocio, setNegocio] = useState<Negocio | null>(null);
  const [buscaNeg, setBuscaNeg] = useState('');
  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [ventaId, setVentaId] = useState('');
  const [tipo, setTipo] = useState('VENTA');
  const [modo, setModo] = useState<'pct' | 'fijo'>('pct');
  const [base, setBase] = useState('');
  const [pct, setPct] = useState('');
  const [fijo, setFijo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [estadoInicial, setEstadoInicial] = useState<'GENERADA' | 'EN_REVISION'>('EN_REVISION');
  const [comprobante, setComprobante] = useState<string | null>(null);
  const [comprobanteMime, setComprobanteMime] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);

  const colabFiltrados = useMemo(() => {
    const q = buscaColab.trim().toLowerCase();
    const lista = colaboradores.filter((c) => c.activo || c.codeId === codeId);
    return (q ? lista.filter((c) => `${c.nombre} ${c.code}`.toLowerCase().includes(q)) : lista).slice(0, 40);
  }, [colaboradores, buscaColab, codeId]);
  const colab = colaboradores.find((c) => c.codeId === codeId) ?? null;

  useEffect(() => {
    if (negocio) return;
    const t = setTimeout(() => {
      api<Negocio[]>(`/admin/reporte-comisiones/negocios?q=${encodeURIComponent(buscaNeg)}`)
        .then(setNegocios)
        .catch(() => setNegocios([]));
    }, 250);
    return () => clearTimeout(t);
  }, [buscaNeg, negocio]);

  useEffect(() => {
    setVentas([]);
    setVentaId('');
    if (!negocio) return;
    api<Venta[]>(`/admin/reporte-comisiones/negocios/${negocio.id}/ventas`)
      .then(setVentas)
      .catch(() => setVentas([]));
  }, [negocio]);

  // Al elegir la venta, la base y el tipo se proponen solos (se pueden cambiar).
  useEffect(() => {
    const v = ventas.find((x) => x.id === ventaId);
    if (v) {
      setBase(String(v.grossUsd));
      setTipo(v.isFirstPayment ? 'VENTA' : 'RENOVACION');
    }
  }, [ventaId, ventas]);

  const previa = useMemo(() => {
    if (modo === 'fijo') return Number(fijo) > 0 ? Math.round(Number(fijo) * 100) / 100 : null;
    const b = Number(base);
    const p = Number(pct);
    return b > 0 && p > 0 && p <= 100 ? Math.round(b * p) / 100 : null;
  }, [modo, base, pct, fijo]);

  const listo = !!codeId && !!dia && previa != null && descripcion.trim().length >= 5 && motivo.trim().length >= 5;

  async function crear() {
    setGuardando(true);
    try {
      const r = await api<{ commissionId: string; duplicada: boolean; montoUsd?: number }>('/admin/reporte-comisiones/comisiones', {
        method: 'POST',
        body: JSON.stringify({
          clave,
          fecha: dia,
          recipientCodeId: codeId,
          tenantId: negocio?.id ?? undefined,
          incomeRecordId: ventaId || undefined,
          tipo,
          baseUsd: Number(base) || 0,
          porcentaje: modo === 'pct' ? Number(pct) : undefined,
          montoFijoUsd: modo === 'fijo' ? Number(fijo) : undefined,
          descripcion,
          estadoInicial,
          comprobanteUrl: comprobante ?? undefined,
          comprobanteMime: comprobanteMime ?? undefined,
          motivo,
        }),
      });
      toast(r.duplicada ? 'Esa comisión ya se había creado: no se duplicó.' : `Comisión creada por ${usd(r.montoUsd ?? previa)}.`, 'success');
      onCreada(r.commissionId);
    } catch (e: any) {
      toast(e?.message ?? 'No se pudo crear la comisión', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Nueva comisión" subtitulo="Comisión creada a mano. El servidor calcula el monto y deja el registro en el historial." onCerrar={onCerrar}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Fecha</label>
          <input type="date" className="input" value={dia} onChange={(e) => setDia(e.target.value)} />
        </div>
        <div>
          <label className="label">Tipo</label>
          <select className="input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {TIPOS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.etiqueta}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className="label">Colaborador</label>
          {colab ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
              <span className="text-sm truncate">{colab.etiqueta}</span>
              <button className="text-xs text-mute hover:text-ink" onClick={() => setCodeId('')}>
                Cambiar
              </button>
            </div>
          ) : (
            <>
              <input className="input" placeholder="Buscar por nombre o código…" value={buscaColab} onChange={(e) => setBuscaColab(e.target.value)} />
              <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-line2 divide-y divide-line2">
                {colabFiltrados.map((c) => (
                  <li key={c.codeId}>
                    <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg2" onClick={() => {
                        setCodeId(c.codeId);
                        // Su % de siempre como propuesta; se puede cambiar.
                        if (!pct && c.porcentaje > 0) setPct(String(c.porcentaje));
                      }}
                    >
                      {c.etiqueta}
                    </button>
                  </li>
                ))}
                {colabFiltrados.length === 0 && <li className="px-3 py-2 text-xs text-mute">Nadie con ese nombre.</li>}
              </ul>
            </>
          )}
        </div>

        <div className="sm:col-span-2">
          <label className="label">Negocio (opcional en un bono)</label>
          {negocio ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
              <span className="text-sm truncate">{negocio.brandName}</span>
              <button className="text-xs text-mute hover:text-ink" onClick={() => setNegocio(null)}>
                Cambiar
              </button>
            </div>
          ) : (
            <>
              <input className="input" placeholder="Buscar negocio…" value={buscaNeg} onChange={(e) => setBuscaNeg(e.target.value)} />
              {negocios.length > 0 && (
                <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-line2 divide-y divide-line2">
                  {negocios.map((n) => (
                    <li key={n.id}>
                      <button className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg2" onClick={() => setNegocio(n)}>
                        {n.brandName}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {negocio && (
          <div className="sm:col-span-2">
            <label className="label">Venta relacionada (opcional)</label>
            <select className="input" value={ventaId} onChange={(e) => setVentaId(e.target.value)}>
              <option value="">Sin venta relacionada</option>
              {ventas.map((v) => (
                <option key={v.id} value={v.id} disabled={v.status !== 'PAGADO'}>
                  {fecha(v.saleDate)} · {usd(v.grossUsd)} · {v.gateway}
                  {v.isFirstPayment ? ' · venta nueva' : ' · renovación'}
                  {v.status !== 'PAGADO' ? ` · ${v.status.toLowerCase()}` : ''}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-mute mt-1">Si el colaborador ya cobra por esa venta, no se crea otra comisión.</p>
          </div>
        )}

        <div className="sm:col-span-2">
          <div className="tabs w-fit mb-2">
            <button className={`tab ${modo === 'pct' ? 'tab-active' : ''}`} onClick={() => setModo('pct')}>
              Porcentaje
            </button>
            <button className={`tab ${modo === 'fijo' ? 'tab-active' : ''}`} onClick={() => setModo('fijo')}>
              Monto fijo
            </button>
          </div>
          <div className="grid gap-3 grid-cols-2">
            <div>
              <label className="label">Base (USD)</label>
              <input type="number" min="0" step="0.01" inputMode="decimal" className="input" value={base} onChange={(e) => setBase(e.target.value)} />
            </div>
            {modo === 'pct' ? (
              <div>
                <label className="label">Porcentaje</label>
                <input type="number" min="0" max="100" step="0.01" inputMode="decimal" className="input" value={pct} onChange={(e) => setPct(e.target.value)} />
              </div>
            ) : (
              <div>
                <label className="label">Monto fijo (USD)</label>
                <input type="number" min="0" step="0.01" inputMode="decimal" className="input" value={fijo} onChange={(e) => setFijo(e.target.value)} />
              </div>
            )}
          </div>
          <div className="mt-2 text-sm">
            Comisión calculada: <strong>{previa != null ? usd(previa) : '—'}</strong>
          </div>
        </div>

        <div className="sm:col-span-2">
          <label className="label">Descripción</label>
          <textarea className="input" rows={2} maxLength={2000} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Qué se paga y por qué" />
        </div>

        <div className="sm:col-span-2">
          <label className="label">Estado inicial</label>
          <div className="flex flex-wrap gap-2">
            <label className={`rounded-lg border px-3 py-2 text-sm cursor-pointer ${estadoInicial === 'EN_REVISION' ? 'border-brand bg-brand/5' : 'border-line'}`}>
              <input type="radio" className="mr-2" checked={estadoInicial === 'EN_REVISION'} onChange={() => setEstadoInicial('EN_REVISION')} />
              En revisión <span className="text-mute">— no se paga hasta que alguien la apruebe</span>
            </label>
            <label className={`rounded-lg border px-3 py-2 text-sm cursor-pointer ${estadoInicial === 'GENERADA' ? 'border-brand bg-brand/5' : 'border-line'}`}>
              <input type="radio" className="mr-2" checked={estadoInicial === 'GENERADA'} onChange={() => setEstadoInicial('GENERADA')} />
              Generada <span className="text-mute">— se libera sola a los 15 días de la fecha</span>
            </label>
          </div>
        </div>

        <div className="sm:col-span-2">
          <FileUploader
            value={comprobante}
            contentType={comprobanteMime}
            onChange={(u, meta) => {
              setComprobante(u);
              setComprobanteMime(meta?.contentType ?? null);
            }}
            folder="comprobantes"
            kind="imageOrPdf"
            label="Comprobante (opcional)"
          />
        </div>

        <div className="sm:col-span-2">
          <CampoMotivo value={motivo} onChange={setMotivo} />
        </div>
      </div>
      <div className="flex gap-2 justify-end mt-5">
        <button className="btn-ghost" onClick={onCerrar} disabled={guardando}>
          Cancelar
        </button>
        <button className="btn-primary" onClick={crear} disabled={!listo || guardando}>
          {guardando ? 'Creando…' : 'Crear comisión'}
        </button>
      </div>
    </Modal>
  );
}

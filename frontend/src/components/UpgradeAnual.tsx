'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { planDisplayName, type PlanPeriodicity } from '@/lib/plan-format';

// ============================================================================
//   UPGRADE A PLAN ANUAL
// ============================================================================
// Pasar un negocio de mensual / trimestral / semestral a ANUAL cobrándole UNA
// vez un monto que puede ser MENOR que el de lista (se pacta con el cliente).
//
// Es el hermano mayor de «Cambiar plan» (ChangePlanPeriodModal, en la ficha del
// negocio): aquel solo mueve la periodicidad y NO cobra; este cobra, lo mete en
// Contabilidad y genera la comisión del afiliado sobre el monto REALMENTE
// pagado. Por eso vive aparte y pide una confirmación explícita antes de nada.
//
// Lo que más duele si se hace mal, y por eso está tan guiado:
//  · La suscripción anterior sigue viva en la pasarela → su próximo cobro le
//    acorta la renovación al negocio (aparece vencido y el cron de mora lo
//    suspende aunque tenga el año pagado) y le genera al afiliado otra comisión.
//    De ahí la casilla obligatoria.
//  · Un doble clic cobrando dos veces → la referencia de la operación se genera
//    UNA sola vez al abrir el modal y se reutiliza en TODOS los reintentos. No
//    se regenera tras un error: es lo único que convierte el segundo intento en
//    «esto ya estaba hecho» en vez de en un segundo cobro.

/** Cuántos meses cubre el plan anual. */
const MESES_DEL_ANUAL = 12;
/** Cota que aplica el backend a la fecha del cobro (días hacia atrás). */
const DIAS_HACIA_ATRAS_MAX = 30;

type MetodoDePago = 'NEQUI' | 'EFECTIVO' | 'TRANSFERENCIA' | 'OTRO';

const METODO_LABEL: Record<MetodoDePago, string> = {
  NEQUI: 'Nequi',
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  OTRO: 'Otro',
};

/** La previsualización: todo lo que hace falta ANTES de cobrar. No escribe. */
export type UpgradePreview = {
  tenantId: string;
  brandName: string;
  estadoDelNegocio: string;
  plan: { id: string; nombre: string } | null;
  periodicidadActual: string;
  periodicidadDestino: 'ANUAL';
  standardPriceUsd: number;
  currency: string;
  coberturaActualHasta: string | null;
  effectiveAt: string;
  nextRenewalAt: string;
  acortaCoberturaPrevia: boolean;
  precioPactadoUsd: number | null;
  cancelacionEnPasarela: {
    estado: string;
    referencia: string | null;
    automatica: boolean;
    requiereConfirmacion: boolean;
  };
  enlaceDePago: { id: string; nombre: string; url: string } | null;
  avisos: string[];
  sePuede: boolean;
  motivo: string | null;
  upgradeVivo: { id: string; estado: string; createdAt: string } | null;
};

/** Un upgrade, tal como lo devuelve el backend (creación e historial). */
export type UpgradeRow = {
  id: string;
  tenantId: string;
  operationRef: string;
  estado: 'PENDIENTE' | 'COMPLETADO' | 'FALLIDO' | 'CANCELADO';
  de: string;
  a: string;
  standardPriceUsd: number;
  paidAmountUsd: number;
  currency: string;
  metodo: 'MANUAL' | 'PASARELA';
  effectiveAt: string | null;
  nextRenewalAt: string | null;
  commissionAmount: number | null;
  comisionesCreadas: number;
  comisionOmitidaMotivo: string | null;
  motivoDeFallo: string | null;
  notas: string | null;
  precioPactadoAnterior: number | null;
  cancelacion: {
    estado: string;
    referencia: string | null;
    cuando: string | null;
    motivo: string | null;
  };
  barrido: { cuando: string | null; nota: string | null };
  cobroViejo: { detectadoEl: string; veces: number } | null;
  anulacion: {
    cuando: string;
    quien: string | null;
    motivo: string | null;
    estadoAlAnular: string | null;
  } | null;
  createdAt: string;
  repetido: boolean;
  aviso?: string;
  revisarComision?: {
    motivo: string;
    baseQueCorresponde: number;
    advertencia: string;
  };
};

type AnularResp = UpgradeRow & {
  advertencia: string;
  quedaPorArreglarAMano: string[];
};

// ─────────────────────────────── Formato ───────────────────────────────────

/** $1.234,00 USD — con dos decimales siempre: es dinero y se contrasta con un
 *  comprobante. */
export function usd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return `$${Number(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} USD`;
}

export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function fechaLarga(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function hoyLocalISO(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function haceDiasISO(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

/** Suma meses acotando el día al último del mes destino (31-ene + 12 meses =
 *  31-ene, pero 29-feb + 12 = 28-feb). Espejo de `addPlanPeriod` del backend:
 *  si difieren, el resumen anunciaría una renovación que no es la que se va a
 *  guardar. */
function sumaMesesAcotado(desde: Date, meses: number): Date {
  const d = new Date(desde);
  const dia = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + meses);
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(dia, ultimo));
  return d;
}

/** La renovación que le va a quedar al negocio si el cobro entra con esa fecha. */
function proximaRenovacion(fechaISO: string): Date | null {
  const base = fechaISO ? new Date(`${fechaISO}T12:00:00`) : new Date();
  if (Number.isNaN(base.getTime())) return null;
  return sumaMesesAcotado(base, MESES_DEL_ANUAL);
}

/**
 * La referencia de la operación: lo que evita cobrar dos veces por un doble
 * clic. Se genera UNA vez al abrir el modal y viaja igual en cada reintento.
 *
 * El `Math.random` es solo la red de abajo: `crypto.randomUUID` no existe en
 * contextos no seguros (http contra una IP de la red local, que es como se
 * prueba el panel a veces) y sin esto el modal reventaría al abrir.
 */
function nuevaReferencia(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `upg-${crypto.randomUUID()}`;
    }
  } catch {
    /* sigue al respaldo */
  }
  return `upg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Por qué este upgrade no generó comisión, en una frase que se puede leer. */
function motivoSinComision(motivo: string | null): string | null {
  if (!motivo) return null;
  if (motivo.startsWith('REVISAR:')) return null; // ya se avisa aparte, en rojo
  if (motivo === 'sin-afiliado') {
    return 'No se generó comisión: este negocio no llegó por ningún afiliado.';
  }
  if (motivo === 'marca-pago-unico') {
    return 'No se generó comisión: en esta marca al afiliado se le paga una sola vez por referido, y un upgrade no es un referido nuevo.';
  }
  if (motivo === 'base-o-pct-0') {
    return 'No se generó comisión: el porcentaje del afiliado es 0.';
  }
  if (motivo === 'la-creo-la-pasarela-y-la-corrigio-el-upgrade') {
    return 'La comisión la había creado la pasarela sobre el plan anterior y este upgrade la corrigió al monto real.';
  }
  return null;
}

const ESTADO_BADGE: Record<
  UpgradeRow['estado'],
  { clase: string; texto: string }
> = {
  COMPLETADO: { clase: 'bg-brand-soft text-brand', texto: 'Aplicado' },
  PENDIENTE: { clase: 'bg-warn-soft text-warn-ink', texto: 'Pendiente' },
  FALLIDO: { clase: 'bg-bad-soft text-bad-ink', texto: 'No se aplicó' },
  CANCELADO: { clase: 'badge-mute', texto: 'Anulado' },
};

// ============================================================================
//   Botón «Upgrade a Plan Anual» (va dentro de la tarjeta «Plan actual»)
// ============================================================================

export function UpgradeAnualButton({
  tenantId,
  pasarela,
  onUpgraded,
  refreshKey = 0,
}: {
  tenantId: string;
  /** Cómo se llama la pasarela de ESTA marca. Nunca se inventa un nombre. */
  pasarela: string;
  /** Recarga el negocio y el historial: el upgrade cambia plan, fecha y cobro. */
  onUpgraded: () => void;
  /** Sube cuando algo cambia fuera (p. ej. al ANULAR desde el historial): sin
   *  esto el botón seguía apagado con el motivo viejo hasta recargar la página. */
  refreshKey?: number;
}) {
  const [preview, setPreview] = useState<UpgradePreview | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setPreview(await api<UpgradePreview>(`/tenants/${tenantId}/upgrades/preview`));
    } catch (e) {
      // Distinguir «no se puede» de «no se pudo preguntar»: si esto se pintara
      // como un botón deshabilitado sin más, un fallo de red se leería como
      // «este negocio no es candidato» y nadie lo volvería a intentar.
      setError(e instanceof Error ? e.message : 'No se pudo consultar el upgrade.');
    } finally {
      setCargando(false);
    }
  }, [tenantId]);

  useEffect(() => {
    cargar();
  }, [cargar, refreshKey]);

  // Que YA esté en anual no es un problema que avisar en ámbar: es el estado
  // normal de un negocio al que ya se le hizo el upgrade. El motivo se sigue
  // viendo —el botón apagado sin explicación es lo que no queremos—, pero en
  // tono neutro. Se decide por el DATO, no por el texto del motivo.
  const yaEsAnual = preview?.periodicidadActual === 'ANUAL';

  return (
    <div className="mt-4 pt-4 border-t border-line2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink">Upgrade a Plan Anual</div>
          {!yaEsAnual && (
            <p className="text-xs text-mute mt-0.5 leading-relaxed">
              Le cobras una sola vez —puede ser menos que el precio de lista— y
              el negocio queda en anual desde hoy, con su cobro registrado y la
              comisión del afiliado sobre lo que pagó de verdad.
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn-primary text-sm shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={cargando || !!error || !preview?.sePuede}
          onClick={() => setAbierto(true)}
        >
          {cargando ? 'Cargando…' : 'Upgrade a Plan Anual'}
        </button>
      </div>

      {/* El motivo VISIBLE, no escondido en un tooltip: quien mira la ficha
          tiene que poder leer por qué no se puede y qué hacer en su lugar. */}
      {!cargando && error && (
        <div className="mt-3 rounded-lg bg-bad-soft border border-bad/30 px-3.5 py-2.5 text-xs text-bad-ink leading-relaxed">
          {error}{' '}
          <button type="button" className="btn-link text-xs" onClick={cargar}>
            Reintentar
          </button>
        </div>
      )}
      {!cargando && !error && preview && !preview.sePuede && preview.motivo && (
        <div
          className={
            yaEsAnual
              ? 'mt-2 text-xs text-mute leading-relaxed'
              : 'mt-3 rounded-lg bg-warn-soft border border-warn/30 px-3.5 py-2.5 text-xs text-warn-ink leading-relaxed'
          }
        >
          {preview.motivo}
        </div>
      )}

      {abierto && (
        <UpgradeAnualModal
          tenantId={tenantId}
          pasarela={pasarela}
          onClose={() => setAbierto(false)}
          onAplicado={() => {
            cargar();
            onUpgraded();
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
//   El modal
// ============================================================================

function UpgradeAnualModal({
  tenantId,
  pasarela,
  onClose,
  onAplicado,
}: {
  tenantId: string;
  pasarela: string;
  onClose: () => void;
  onAplicado: () => void;
}) {
  // LA REFERENCIA DE LA OPERACIÓN SE GENERA UNA SOLA VEZ, AL ABRIR.
  // Es lo que evita cobrar dos veces: si el POST falla y se reintenta, va la
  // MISMA y el backend devuelve «esto ya estaba hecho» en vez de cobrar otra
  // vez. Por eso vive en un ref y no en un estado que se pueda recalcular.
  const referencia = useRef<string>(nuevaReferencia());

  const [preview, setPreview] = useState<UpgradePreview | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const hoy = hoyLocalISO();
  const [monto, setMonto] = useState('');
  const [metodoDePago, setMetodoDePago] = useState<MetodoDePago>('TRANSFERENCIA');
  const [referenciaCobro, setReferenciaCobro] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [canceleLaAnterior, setCanceleLaAnterior] = useState(false);

  const [paso, setPaso] = useState<'datos' | 'resumen' | 'resultado'>('datos');
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [resultado, setResultado] = useState<UpgradeRow | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const p = await api<UpgradePreview>(`/tenants/${tenantId}/upgrades/preview`);
        if (!vivo) return;
        setPreview(p);
        // El precio estándar del anual es la SUGERENCIA, no una imposición: el
        // monto real se pacta con el cliente y es editable.
        setMonto(String(Number(p.standardPriceUsd ?? 0)));
      } catch (e) {
        if (!vivo) return;
        setErrorCarga(
          e instanceof Error ? e.message : 'No se pudo cargar la información del upgrade.',
        );
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [tenantId]);

  const montoNum = Number(String(monto).replace(',', '.'));
  const montoOk = Number.isFinite(montoNum) && montoNum > 0;
  const fechaOk = !!fecha && fecha <= hoy && fecha >= haceDiasISO(DIAS_HACIA_ATRAS_MAX);
  const renovacion = proximaRenovacion(fecha);
  const cobertura = preview?.coberturaActualHasta
    ? new Date(preview.coberturaActualHasta)
    : null;
  const acorta =
    !!renovacion && !!cobertura && renovacion.getTime() < cobertura.getTime();
  const exigeCancelacion = !!preview?.cancelacionEnPasarela?.requiereConfirmacion;
  const puedeSeguir =
    !!preview?.sePuede &&
    montoOk &&
    fechaOk &&
    (!exigeCancelacion || canceleLaAnterior);

  async function confirmar() {
    if (!preview || enviando) return;
    setEnviando(true);
    setErrorEnvio(null);
    try {
      const res = await api<UpgradeRow>(`/tenants/${tenantId}/upgrades`, {
        method: 'POST',
        body: JSON.stringify({
          // La MISMA en cada reintento. No se regenera nunca dentro del modal.
          operationRef: referencia.current,
          paidAmountUsd: Math.round(montoNum * 100) / 100,
          currency: 'USD',
          metodo: 'MANUAL',
          metodoDePago,
          ...(referenciaCobro.trim() ? { reference: referenciaCobro.trim() } : {}),
          ...(exigeCancelacion ? { suscripcionAnteriorCancelada: true } : {}),
          // Hoy → instante real. Fecha pasada → mediodía UTC: a medianoche UTC
          // América (UTC-5) la mostraría como el día ANTERIOR.
          effectiveAt:
            fecha === hoy ? new Date().toISOString() : `${fecha}T12:00:00.000Z`,
        }),
      });
      setResultado(res);
      setPaso('resultado');
      onAplicado();
    } catch (e) {
      // El mensaje del backend va TAL CUAL: están escritos en español y dicen
      // qué hacer. Reescribirlos aquí es perder la instrucción.
      setErrorEnvio(
        e instanceof Error ? e.message : 'No se pudo aplicar el upgrade.',
      );
      setPaso('datos');
    } finally {
      setEnviando(false);
    }
  }

  const periodicidadActual = (preview?.periodicidadActual ?? null) as
    | PlanPeriodicity
    | null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-end md:items-center justify-center p-3 md:p-6 animate-in fade-in duration-150"
      // Ni en el resultado ni MIENTRAS se aplica: un clic fuera durante el POST
      // deja el cobro hecho y al usuario sin ver la comisión ni los avisos.
      onClick={paso === 'resultado' || enviando ? undefined : onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-[0_25px_70px_-12px_rgba(0,0,0,0.45)] border border-line2 w-full max-w-xl max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom-6 md:slide-in-from-bottom-2 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-line2 flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold m-0 text-ink truncate">
              {paso === 'resultado' ? 'Upgrade aplicado' : 'Upgrade a Plan Anual'}
            </h3>
            {preview && (
              <p className="text-xs text-mute m-0 mt-0.5 truncate">
                {preview.brandName}
              </p>
            )}
          </div>
          <button
            type="button"
            className="text-mute hover:text-ink text-2xl leading-none cursor-pointer touch-manipulation select-none active:scale-[0.97] transition-transform duration-150 [-webkit-tap-highlight-color:transparent] disabled:opacity-40"
            onClick={onClose}
            disabled={enviando}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {cargando && <div className="pulse-soft h-40 w-full" />}

          {!cargando && errorCarga && (
            <div className="rounded-lg bg-bad-soft border border-bad/30 px-3.5 py-3 text-sm text-bad-ink leading-relaxed">
              {errorCarga}
            </div>
          )}

          {!cargando && preview && !preview.sePuede && preview.motivo && (
            <div className="rounded-lg bg-warn-soft border border-warn/30 px-3.5 py-3 text-sm text-warn-ink leading-relaxed">
              {preview.motivo}
            </div>
          )}

          {/* ── PASO 1: los datos del cobro ───────────────────────────────── */}
          {!cargando && preview && preview.sePuede && paso === 'datos' && (
            <>
              {errorEnvio && (
                <div className="rounded-lg bg-bad-soft border border-bad/30 px-3.5 py-3 text-sm text-bad-ink leading-relaxed">
                  <div className="font-semibold mb-1">No se aplicó nada.</div>
                  {errorEnvio}
                </div>
              )}

              {/* De dónde sale y a dónde va */}
              <div className="rounded-lg border border-line bg-bg2/40 px-3.5 py-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
                      Ahora
                    </div>
                    <div className="font-medium text-ink">
                      {planDisplayName(preview.plan?.nombre, periodicidadActual)}
                    </div>
                  </div>
                  <div className="text-mute">→</div>
                  <div className="text-right">
                    <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
                      Queda en
                    </div>
                    <div className="font-semibold text-brand">Plan Anual</div>
                  </div>
                </div>
                <div className="mt-2.5 pt-2.5 border-t border-line2 flex justify-between text-sm">
                  <span className="text-mute">Precio estándar del anual</span>
                  <span className="font-semibold">{usd(preview.standardPriceUsd)}</span>
                </div>
                {preview.coberturaActualHasta && (
                  <div className="mt-1 flex justify-between text-sm">
                    <span className="text-mute">Hoy está cubierto hasta</span>
                    <span className="font-medium">
                      {fechaCorta(preview.coberturaActualHasta)}
                    </span>
                  </div>
                )}
              </div>

              {/* Avisos del backend, tal cual: ahí viene el del precio pactado */}
              {preview.avisos.length > 0 && (
                <div className="rounded-lg bg-warn-soft border border-warn/30 px-3.5 py-3 text-xs text-warn-ink leading-relaxed space-y-2">
                  {preview.avisos.map((a, i) => (
                    <p key={i} className="m-0">
                      {a}
                    </p>
                  ))}
                </div>
              )}

              {/* Cómo se cobró */}
              <div>
                <label className="label">Cómo se cobró</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="p-3 rounded-lg border border-brand bg-brand-soft">
                    <div className="text-sm font-semibold text-ink">
                      Por fuera (Nequi, efectivo, transferencia)
                    </div>
                    <div className="text-xs text-mute mt-0.5">
                      El dinero ya entró y lo registras aquí.
                    </div>
                  </div>
                  {/* El cobro por pasarela está construido en el backend pero
                      todavía cerrado: se muestra para que nadie lo busque, no
                      para que lo pulse. */}
                  <div className="p-3 rounded-lg border border-line bg-bg2/40 opacity-70">
                    <div className="text-sm font-semibold text-mute">
                      Por pasarela — no disponible
                    </div>
                    <div className="text-xs text-mute mt-0.5">
                      Todavía no está abierto; cóbralo y regístralo como manual.
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label">Monto que pagó (USD)</label>
                  <input
                    className="input"
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={monto}
                    onChange={(e) => setMonto(e.target.value)}
                  />
                  <p className="text-[11px] text-mute mt-1 leading-relaxed">
                    Lo que pagó DE VERDAD. Sobre este monto se calcula la
                    comisión del afiliado.
                  </p>
                  {!montoOk && monto !== '' && (
                    <p className="text-[11px] text-bad-ink mt-1">
                      El monto tiene que ser mayor que cero.
                    </p>
                  )}
                </div>
                <div>
                  <label className="label">Método de pago</label>
                  <select
                    className="input"
                    value={metodoDePago}
                    onChange={(e) => setMetodoDePago(e.target.value as MetodoDePago)}
                  >
                    {(Object.keys(METODO_LABEL) as MetodoDePago[]).map((m) => (
                      <option key={m} value={m}>
                        {METODO_LABEL[m]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Referencia del cobro (opcional)</label>
                  <input
                    className="input"
                    value={referenciaCobro}
                    maxLength={120}
                    placeholder="Número del comprobante, últimos dígitos…"
                    onChange={(e) => setReferenciaCobro(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Fecha del cobro</label>
                  <input
                    className="input"
                    type="date"
                    value={fecha}
                    max={hoy}
                    min={haceDiasISO(DIAS_HACIA_ATRAS_MAX)}
                    onChange={(e) => setFecha(e.target.value)}
                  />
                  {!fechaOk && (
                    <p className="text-[11px] text-bad-ink mt-1 leading-relaxed">
                      La fecha no puede ser futura ni de hace más de{' '}
                      {DIAS_HACIA_ATRAS_MAX} días: el año de cobertura se cuenta
                      desde ella.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-line bg-bg2/40 px-3.5 py-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-mute">El plan anual empieza el</span>
                  <span className="font-medium">
                    {fechaOk ? fechaLarga(`${fecha}T12:00:00`) : '—'}
                  </span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className="text-mute">Próxima renovación</span>
                  <span className="font-semibold text-brand">
                    {renovacion && fechaOk
                      ? fechaLarga(renovacion.toISOString())
                      : '—'}
                  </span>
                </div>
                {acorta && (
                  <p className="mt-2 mb-0 text-xs text-warn-ink leading-relaxed">
                    Ojo: con esa fecha el negocio quedaría cubierto MENOS de lo
                    que ya estaba (hoy llega hasta{' '}
                    {fechaCorta(preview.coberturaActualHasta)}).
                  </p>
                )}
              </div>

              {/* La casilla obligatoria de la suscripción anterior */}
              {exigeCancelacion && (
                <div className="rounded-lg bg-warn-soft border border-warn/30 px-3.5 py-3">
                  <div className="text-xs font-semibold text-warn-ink uppercase tracking-wider mb-2">
                    Antes de cobrar
                  </div>
                  <p className="text-xs text-warn-ink leading-relaxed m-0 mb-2">
                    Este negocio todavía tiene una suscripción viva en{' '}
                    {pasarela}. Búscala por esta referencia y cancélala en su
                    panel:
                  </p>
                  <div className="mb-2 px-2.5 py-1.5 rounded bg-white/70 border border-warn/30 text-xs font-mono break-all text-warn-ink">
                    {preview.cancelacionEnPasarela.referencia ?? '—'}
                  </div>
                  <p className="text-xs text-warn-ink leading-relaxed m-0 mb-2.5">
                    Al cancelar allí, al cliente le llega el correo de
                    cancelación de su marca y al equipo un SMS de «cancelado».
                    Avísale tú antes, o va a leer «se canceló tu suscripción»
                    justo después de pagar el año.
                  </p>
                  <label className="flex items-start gap-2.5 cursor-pointer touch-manipulation select-none text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={canceleLaAnterior}
                      onChange={(e) => setCanceleLaAnterior(e.target.checked)}
                      className="accent-brand mt-0.5"
                    />
                    <span>
                      Ya cancelé la suscripción anterior en {pasarela}.
                    </span>
                  </label>
                </div>
              )}
            </>
          )}

          {/* ── PASO 2: el resumen, antes de tocar nada ───────────────────── */}
          {!cargando && preview && paso === 'resumen' && (
            <>
              <p className="text-sm text-mute m-0 leading-relaxed">
                Revisa antes de cobrar. Al confirmar se registra el cobro, el
                negocio pasa a anual y se genera la comisión del afiliado.
              </p>
              <dl className="rounded-lg border border-line bg-bg2/40 px-3.5 py-3 text-sm space-y-1.5">
                <div className="flex justify-between gap-3">
                  <dt className="text-mute">Negocio</dt>
                  <dd className="font-medium text-right">{preview.brandName}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-mute">Plan actual</dt>
                  <dd className="font-medium text-right">
                    {planDisplayName(preview.plan?.nombre, periodicidadActual)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-mute">Nuevo plan</dt>
                  <dd className="font-semibold text-brand text-right">Plan Anual</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-mute">Precio estándar del anual</dt>
                  <dd className="font-medium text-right">
                    {usd(preview.standardPriceUsd)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-mute">Monto que pagará</dt>
                  <dd className="font-semibold text-right">{usd(montoNum)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-mute">Método</dt>
                  <dd className="font-medium text-right">
                    {METODO_LABEL[metodoDePago]}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-mute">Empieza el</dt>
                  <dd className="font-medium text-right">
                    {fechaLarga(`${fecha}T12:00:00`)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-mute">Próxima renovación</dt>
                  <dd className="font-medium text-right">
                    {renovacion ? fechaLarga(renovacion.toISOString()) : '—'}
                  </dd>
                </div>
              </dl>
              <div className="rounded-lg bg-brand-soft border border-brand/30 px-3.5 py-3 text-sm text-ink leading-relaxed">
                La comisión se calculará sobre {usd(montoNum)}.
              </div>
              {exigeCancelacion && (
                <p className="text-xs text-mute leading-relaxed m-0">
                  Confirmaste que ya cancelaste la suscripción anterior en{' '}
                  {pasarela}
                  {preview.cancelacionEnPasarela.referencia
                    ? ` (${preview.cancelacionEnPasarela.referencia})`
                    : ''}
                  .
                </p>
              )}
            </>
          )}

          {/* ── PASO 3: qué quedó hecho ───────────────────────────────────── */}
          {paso === 'resultado' && resultado && (
            <>
              <div className="rounded-lg bg-brand-soft border border-brand/30 px-3.5 py-3 text-sm text-ink leading-relaxed">
                {resultado.repetido
                  ? 'Este upgrade ya estaba registrado: no se cobró de nuevo.'
                  : `${preview?.brandName ?? 'El negocio'} quedó en Plan Anual.`}
              </div>
              <dl className="rounded-lg border border-line bg-bg2/40 px-3.5 py-3 text-sm space-y-1.5">
                <div className="flex justify-between gap-3">
                  <dt className="text-mute">Cobrado</dt>
                  <dd className="font-semibold text-right">
                    {usd(resultado.paidAmountUsd)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-mute">Próxima renovación</dt>
                  <dd className="font-medium text-right">
                    {fechaLarga(resultado.nextRenewalAt)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-mute">Comisión</dt>
                  <dd className="font-medium text-right">
                    {resultado.comisionesCreadas > 0
                      ? `${usd(resultado.commissionAmount)} · ${resultado.comisionesCreadas} ${
                          resultado.comisionesCreadas === 1
                            ? 'beneficiario'
                            : 'beneficiarios'
                        }`
                      : 'Sin comisión'}
                  </dd>
                </div>
              </dl>

              {motivoSinComision(resultado.comisionOmitidaMotivo) && (
                <p className="text-xs text-mute leading-relaxed m-0">
                  {motivoSinComision(resultado.comisionOmitidaMotivo)}
                </p>
              )}

              {resultado.revisarComision && (
                <div className="rounded-lg bg-bad-soft border border-bad/30 px-3.5 py-3 text-sm text-bad-ink leading-relaxed">
                  <div className="font-semibold mb-1">Hay que revisar la comisión</div>
                  {resultado.revisarComision.advertencia}
                </div>
              )}

              {(resultado.cancelacion.estado === 'PENDIENTE' ||
                resultado.cancelacion.estado === 'FALLIDA') && (
                <div className="rounded-lg bg-warn-soft border border-warn/30 px-3.5 py-3 text-sm text-warn-ink leading-relaxed">
                  La suscripción anterior sigue marcada como SIN cancelar
                  {resultado.cancelacion.referencia
                    ? ` (${resultado.cancelacion.referencia})`
                    : ''}
                  . Cancélala en el panel de {pasarela}: si no, su próximo cobro
                  le acorta la renovación a este negocio y le genera al afiliado
                  otra comisión.
                </div>
              )}

              {resultado.aviso && (
                <p className="text-xs text-mute leading-relaxed m-0">
                  {resultado.aviso}
                </p>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t border-line flex items-center justify-between gap-2 sticky bottom-0 bg-surface">
          {paso === 'resumen' ? (
            <button
              type="button"
              className="btn-link text-sm"
              onClick={() => setPaso('datos')}
              disabled={enviando}
            >
              ← Volver a los datos
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            {paso !== 'resultado' && (
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={onClose}
                disabled={enviando}
              >
                Cancelar
              </button>
            )}
            {paso === 'datos' && (
              <button
                type="button"
                className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!puedeSeguir}
                onClick={() => setPaso('resumen')}
              >
                Continuar
              </button>
            )}
            {paso === 'resumen' && (
              <button
                type="button"
                className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={enviando || !puedeSeguir}
                onClick={confirmar}
              >
                {enviando ? 'Aplicando…' : 'Confirmar upgrade'}
              </button>
            )}
            {paso === 'resultado' && (
              <button type="button" className="btn-primary text-sm" onClick={onClose}>
                Cerrar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
//   Historial de upgrades del negocio
// ============================================================================

export function UpgradesHistoryCard({
  tenantId,
  refreshKey,
  onChange,
}: {
  tenantId: string;
  /** Cambia cuando se aplica un upgrade desde la tarjeta del plan. */
  refreshKey: number;
  onChange: () => void;
}) {
  const [filas, setFilas] = useState<UpgradeRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [anulando, setAnulando] = useState<UpgradeRow | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const data = await api<{ upgrades: UpgradeRow[] }>(
        `/tenants/${tenantId}/upgrades`,
      );
      setFilas(data?.upgrades ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el historial.');
    } finally {
      setCargando(false);
    }
  }, [tenantId]);

  useEffect(() => {
    cargar();
  }, [cargar, refreshKey]);

  // Sin upgrades no se pinta nada: la ficha del negocio ya es larga y la
  // inmensa mayoría no tiene ninguno. El botón para hacerlo está arriba.
  if (!cargando && !error && filas.length === 0) return null;

  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold m-0">Upgrades a plan anual</h2>
          <p className="text-xs text-mute mt-1">
            Los cobros de una sola vez con los que este negocio pasó a anual.
          </p>
        </div>
        <Link href="/admin/upgrades" className="btn-link text-sm">
          Ver pendientes
        </Link>
      </div>

      {cargando && <div className="pulse-soft h-20 w-full mt-4" />}

      {!cargando && error && (
        <div className="mt-4 rounded-lg bg-bad-soft border border-bad/30 px-3.5 py-2.5 text-xs text-bad-ink">
          {error}
        </div>
      )}

      {!cargando && !error && filas.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="text-left text-mute text-[11px] uppercase tracking-wider">
              <tr>
                <th className="py-2 pr-3 font-semibold">Fecha</th>
                <th className="py-2 pr-3 font-semibold text-right">Monto</th>
                <th className="py-2 pr-3 font-semibold">Cómo se cobró</th>
                <th className="py-2 pr-3 font-semibold">Estado</th>
                <th className="py-2 pr-3 font-semibold text-right">Comisión</th>
                <th className="py-2 font-semibold text-right">&nbsp;</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line2">
              {filas.map((u) => {
                const badge = ESTADO_BADGE[u.estado] ?? ESTADO_BADGE.PENDIENTE;
                return (
                  <tr key={u.id} className="align-top">
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      {fechaCorta(u.effectiveAt ?? u.createdAt)}
                    </td>
                    <td className="py-2.5 pr-3 text-right whitespace-nowrap font-medium">
                      {usd(u.paidAmountUsd)}
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      {u.metodo === 'PASARELA' ? 'Por pasarela' : 'Por fuera'}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className={`badge ${badge.clase}`}>{badge.texto}</span>
                      {u.estado === 'FALLIDO' && u.motivoDeFallo && (
                        <div className="text-[11px] text-mute mt-1 max-w-[260px] leading-relaxed">
                          {u.motivoDeFallo}
                        </div>
                      )}
                      {u.anulacion?.motivo && (
                        <div className="text-[11px] text-mute mt-1 max-w-[260px] leading-relaxed">
                          Motivo: {u.anulacion.motivo}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right whitespace-nowrap">
                      {u.comisionesCreadas > 0 ? usd(u.commissionAmount) : '—'}
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      {u.estado !== 'CANCELADO' && (
                        <button
                          type="button"
                          className="btn-link text-xs"
                          onClick={() => setAnulando(u)}
                        >
                          Anular
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {anulando && (
        <AnularUpgradeModal
          tenantId={tenantId}
          upgrade={anulando}
          onClose={() => setAnulando(null)}
          onAnulado={() => {
            cargar();
            onChange();
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
//   Anular un upgrade
// ============================================================================

function AnularUpgradeModal({
  tenantId,
  upgrade,
  onClose,
  onAnulado,
}: {
  tenantId: string;
  upgrade: UpgradeRow;
  onClose: () => void;
  onAnulado: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<AnularResp | null>(null);

  const motivoOk = motivo.trim().length >= 5;

  async function anular() {
    if (!motivoOk || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await api<AnularResp>(
        `/tenants/${tenantId}/upgrades/${upgrade.id}/anular`,
        { method: 'POST', body: JSON.stringify({ motivo: motivo.trim() }) },
      );
      setResultado(res);
      onAnulado();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo anular el upgrade.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-end md:items-center justify-center p-3 md:p-6 animate-in fade-in duration-150"
      onClick={resultado ? undefined : onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-[0_25px_70px_-12px_rgba(0,0,0,0.45)] border border-line2 w-full max-w-lg max-h-[90vh] overflow-y-auto animate-in slide-in-from-bottom-6 md:slide-in-from-bottom-2 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-line2 flex items-center justify-between">
          <h3 className="text-lg font-semibold m-0 text-ink">Anular el upgrade</h3>
          <button
            type="button"
            className="text-mute hover:text-ink text-2xl leading-none cursor-pointer"
            onClick={onClose}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {!resultado && (
            <>
              <div className="rounded-lg bg-warn-soft border border-warn/30 px-3.5 py-3 text-xs text-warn-ink leading-relaxed">
                <div className="font-semibold mb-1">Esto no deshace nada.</div>
                Anular es solo un apunte administrativo: libera el candado para
                poder volver a subir este negocio a anual. NO devuelve el plan a
                como estaba, NO devuelve el cobro y NO anula la comisión del
                afiliado. Lo que haya que deshacer se hace a mano.
              </div>
              <dl className="rounded-lg border border-line bg-bg2/40 px-3.5 py-3 text-sm space-y-1.5">
                <div className="flex justify-between gap-3">
                  <dt className="text-mute">Fecha</dt>
                  <dd className="font-medium">
                    {fechaCorta(upgrade.effectiveAt ?? upgrade.createdAt)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-mute">Monto cobrado</dt>
                  <dd className="font-semibold">{usd(upgrade.paidAmountUsd)}</dd>
                </div>
              </dl>
              <div>
                <label className="label">Por qué se anula</label>
                <textarea
                  className="input"
                  rows={3}
                  maxLength={500}
                  value={motivo}
                  placeholder="Se cobró al negocio equivocado, el monto estaba mal…"
                  onChange={(e) => setMotivo(e.target.value)}
                />
                <p className="text-[11px] text-mute mt-1">
                  Mínimo 5 caracteres. Es lo único que explica, dentro de seis
                  meses, por qué se liberó el candado de este negocio.
                </p>
              </div>
              {error && (
                <div className="rounded-lg bg-bad-soft border border-bad/30 px-3.5 py-3 text-sm text-bad-ink leading-relaxed">
                  {error}
                </div>
              )}
            </>
          )}

          {resultado && (
            <>
              <div className="rounded-lg bg-warn-soft border border-warn/30 px-3.5 py-3 text-sm text-warn-ink leading-relaxed">
                {resultado.advertencia}
              </div>
              {resultado.quedaPorArreglarAMano.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-mute uppercase tracking-wider mb-2">
                    Queda por arreglar a mano
                  </div>
                  <ul className="list-disc list-inside space-y-1.5 text-sm text-ink leading-relaxed">
                    {resultado.quedaPorArreglarAMano.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t border-line flex items-center justify-end gap-2">
          {resultado ? (
            <button type="button" className="btn-primary text-sm" onClick={onClose}>
              Entendido
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={onClose}
                disabled={enviando}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-danger text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!motivoOk || enviando}
                onClick={anular}
              >
                {enviando ? 'Anulando…' : 'Anular upgrade'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
//   «Ya la cancelé» — cerrar la cancelación pendiente de un upgrade
// ============================================================================

/** Botón suelto: lo usa la pantalla de pendientes del panel. */
export function ConfirmarCancelacionButton({
  tenantId,
  upgradeId,
  onHecho,
}: {
  tenantId: string;
  upgradeId: string;
  onHecho: () => void;
}) {
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    if (enviando) return;
    setEnviando(true);
    try {
      await api(`/tenants/${tenantId}/upgrades/${upgradeId}/cancelacion-confirmada`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      toast('Cancelación registrada.', 'success');
      onHecho();
    } catch (e) {
      toast(
        e instanceof Error ? e.message : 'No se pudo registrar la cancelación.',
        'error',
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <button
      type="button"
      className="btn-ghost text-xs disabled:opacity-50"
      disabled={enviando}
      onClick={confirmar}
    >
      {enviando ? 'Guardando…' : 'Ya la cancelé'}
    </button>
  );
}

'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import {
  ConfirmarCancelacionButton,
  fechaCorta,
  usd,
} from '@/components/UpgradeAnual';

// ============================================================================
//   UPGRADES A PLAN ANUAL — lo que quedó pendiente
// ============================================================================
// El upgrade a anual cobra, cambia el plan y genera la comisión en una sola
// transacción. Lo que NO puede hacer solo —cancelar la suscripción vieja en la
// pasarela, porque no hay credenciales de API— y lo que detecta después el
// guardián nocturno, sale aquí.
//
// Esta pantalla existe porque el aviso vivía en un campo de la tabla y en un
// log: si un upgrade se cobra y deja a un afiliado sin su comisión, eso no
// puede terminar en silencio.

type Pendientes = {
  total: number;
  vencidas: number;
  horas: number;
  /** Upgrades cobrados cuya comisión quedó sin resolver. Es dinero de alguien. */
  comisionesARevisar: Array<{
    id: string;
    tenantId: string;
    createdAt: string;
    motivo: string | null;
    queHayQueMirar: string;
    paidAmountUsd: number;
    commissionId: string | null;
    commissionAmount: number | null;
    metodo: string;
    barridoNota: string | null;
  }>;
  /** Suscripciones viejas que siguen vivas en la pasarela. */
  items: Array<{
    id: string;
    tenantId: string;
    createdAt: string;
    horasSinCerrar: number;
    cancelacionEstado: string;
    cancelacionRef: string | null;
    cancelacionMotivo: string | null;
    avisadaEl: string | null;
    vencida: boolean;
  }>;
  /** Negocios a los que entró un cobro del ciclo anterior y hubo que restaurar. */
  cobrosViejos: Array<{
    id: string;
    tenantId: string;
    detectadoEl: string | null;
    ultimaVez: string | null;
    veces: number;
    renovacionPisada: string | null;
    renovacionRestaurada: string | null;
    comisionesParaRevisar: string[];
    cancelacionRef: string | null;
  }>;
  /** Actas esperando a que entre el pago por la pasarela. */
  porPasarela: Array<{
    id: string;
    tenantId: string;
    estado: string;
    createdAt: string;
    horasEsperando: number;
    paidAmountUsd: number;
    barridoNota: string | null;
  }>;
};

/** Cuánto tiempo lleva sin cerrarse, en palabras. */
function espera(horas: number): string {
  if (horas < 1) return 'menos de 1 h';
  if (horas < 48) return `${horas} h`;
  return `${Math.floor(horas / 24)} días`;
}

export default function UpgradesPendientesPage() {
  const [data, setData] = useState<Pendientes | null>(null);
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [horas, setHoras] = useState(24);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setData(
        await api<Pendientes>(
          `/tenants/upgrades/cancelaciones-pendientes?horas=${horas}`,
        ),
      );
    } catch (e) {
      // «Vacío» y «no se pudo preguntar» se ven igual si no se distinguen, y
      // esta pantalla en blanco significaría «no hay nada pendiente».
      setError(
        e instanceof Error ? e.message : 'No se pudieron cargar los pendientes.',
      );
    } finally {
      setCargando(false);
    }
  }, [horas]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Los nombres de los negocios: el endpoint devuelve solo identificadores y
  // una lista de códigos no se puede leer. Si falla, se muestra el enlace igual.
  useEffect(() => {
    let vivo = true;
    api<Array<{ id: string; brandName: string }>>('/tenants')
      .then((lista) => {
        if (!vivo) return;
        const mapa: Record<string, string> = {};
        for (const t of lista ?? []) mapa[t.id] = t.brandName;
        setNombres(mapa);
      })
      .catch(() => {
        /* sin nombres se sigue trabajando: el enlace lleva a la ficha igual */
      });
    return () => {
      vivo = false;
    };
  }, []);

  const negocio = (tenantId: string) => (
    <Link
      href={`/admin/tenants/${tenantId}`}
      className="btn-link text-sm font-medium"
    >
      {nombres[tenantId] ?? 'Ver el negocio'}
    </Link>
  );

  const nada =
    !!data &&
    data.items.length === 0 &&
    data.cobrosViejos.length === 0 &&
    data.comisionesARevisar.length === 0 &&
    data.porPasarela.length === 0;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <h1 className="text-2xl font-bold m-0">Upgrades a plan anual</h1>
        <div className="flex items-center gap-2">
          <select
            className="input w-auto text-sm py-2"
            value={horas}
            onChange={(e) => setHoras(Number(e.target.value))}
          >
            <option value={12}>Avisar a partir de 12 h</option>
            <option value={24}>Avisar a partir de 24 h</option>
            <option value={48}>Avisar a partir de 48 h</option>
            <option value={72}>Avisar a partir de 72 h</option>
          </select>
          <button className="btn-ghost text-sm" onClick={cargar}>
            Actualizar
          </button>
        </div>
      </div>
      <p className="text-sm text-mute mb-5 leading-relaxed">
        Lo que los upgrades a anual dejaron sin cerrar: suscripciones anteriores
        que siguen vivas en la pasarela, cobros del ciclo viejo que entraron
        igual y comisiones que hay que mirar a mano.
      </p>

      {cargando && <div className="pulse-soft h-48 w-full" />}

      {!cargando && error && (
        <div className="card card-pad">
          <div className="rounded-lg bg-bad-soft border border-bad/30 px-3.5 py-3 text-sm text-bad-ink leading-relaxed">
            {error}
          </div>
        </div>
      )}

      {!cargando && !error && nada && (
        <div className="card card-pad text-center">
          <p className="text-sm text-mute m-0">
            No hay nada pendiente. Todos los upgrades a anual quedaron cerrados.
          </p>
        </div>
      )}

      {!cargando && !error && data && !nada && (
        <div className="space-y-5">
          {/* ── Comisiones a revisar: lo primero, es dinero de alguien ───── */}
          {data.comisionesARevisar.length > 0 && (
            <section className="card card-pad">
              <h2 className="text-base font-semibold m-0">
                Comisiones que hay que mirar ({data.comisionesARevisar.length})
              </h2>
              <p className="text-xs text-mute mt-1 mb-4 leading-relaxed">
                Upgrades que SÍ se cobraron y cuya comisión quedó sin resolver.
              </p>
              <ul className="space-y-3 list-none p-0 m-0">
                {data.comisionesARevisar.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-lg bg-bad-soft border border-bad/30 px-3.5 py-3"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>{negocio(c.tenantId)}</div>
                      <div className="text-xs text-mute">
                        {fechaCorta(c.createdAt)} · cobrado{' '}
                        {usd(c.paidAmountUsd)}
                      </div>
                    </div>
                    <p className="text-sm text-bad-ink leading-relaxed mt-2 mb-0">
                      {c.queHayQueMirar}
                    </p>
                    {c.barridoNota && (
                      <p className="text-[11px] text-mute leading-relaxed mt-2 mb-0">
                        {c.barridoNota}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── Cancelaciones sin cerrar ─────────────────────────────────── */}
          {data.items.length > 0 && (
            <section className="card card-pad">
              <h2 className="text-base font-semibold m-0">
                Suscripciones anteriores sin cancelar ({data.items.length})
              </h2>
              <p className="text-xs text-mute mt-1 mb-4 leading-relaxed">
                Cancélalas en el panel de la pasarela buscando su referencia y
                marca «Ya la cancelé». Mientras siga viva, su próximo cobro le
                acorta la renovación al negocio y le genera al afiliado otra
                comisión. {data.vencidas > 0 && (
                  <strong className="text-warn-ink">
                    {data.vencidas} llevan más de {data.horas} h.
                  </strong>
                )}
              </p>
              <ul className="space-y-3 list-none p-0 m-0">
                {data.items.map((i) => (
                  <li
                    key={i.id}
                    className={`rounded-lg px-3.5 py-3 border ${
                      i.vencida
                        ? 'bg-warn-soft border-warn/30'
                        : 'bg-bg2/40 border-line'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        {negocio(i.tenantId)}
                        <div className="text-xs text-mute mt-0.5">
                          Sin cerrar desde hace {espera(i.horasSinCerrar)}
                        </div>
                      </div>
                      <ConfirmarCancelacionButton
                        tenantId={i.tenantId}
                        upgradeId={i.id}
                        onHecho={cargar}
                      />
                    </div>
                    <div className="mt-2 text-xs text-mute">
                      Referencia en la pasarela:{' '}
                      <span className="font-mono break-all text-ink">
                        {i.cancelacionRef ?? '—'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── Cobros del ciclo viejo ───────────────────────────────────── */}
          {data.cobrosViejos.length > 0 && (
            <section className="card card-pad">
              <h2 className="text-base font-semibold m-0">
                Cobros del plan anterior que entraron igual (
                {data.cobrosViejos.length})
              </h2>
              <p className="text-xs text-mute mt-1 mb-4 leading-relaxed">
                A estos negocios les entró un cobro del ciclo viejo después del
                upgrade. La fecha de renovación ya se restauró sola; lo que hay
                que decidir a mano es el dinero: devolver el cobro y revisar las
                comisiones que generó.
              </p>
              <ul className="space-y-3 list-none p-0 m-0">
                {data.cobrosViejos.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-lg bg-warn-soft border border-warn/30 px-3.5 py-3"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>{negocio(c.tenantId)}</div>
                      <div className="text-xs text-warn-ink">
                        {c.veces} {c.veces === 1 ? 'vez' : 'veces'} · última{' '}
                        {fechaCorta(c.ultimaVez)}
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-mute leading-relaxed">
                      El cobro viejo había dejado la renovación en{' '}
                      {fechaCorta(c.renovacionPisada)} y se restauró a{' '}
                      {fechaCorta(c.renovacionRestaurada)}.
                    </div>
                    {c.comisionesParaRevisar.length > 0 && (
                      <div className="mt-2 text-xs text-warn-ink leading-relaxed">
                        Generó {c.comisionesParaRevisar.length} comisión(es) que
                        NO se tocaron: hay que revisarlas a mano.
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── Actas esperando el pago por pasarela ─────────────────────── */}
          {data.porPasarela.length > 0 && (
            <section className="card card-pad">
              <h2 className="text-base font-semibold m-0">
                Esperando el pago por la pasarela ({data.porPasarela.length})
              </h2>
              <p className="text-xs text-mute mt-1 mb-4 leading-relaxed">
                Upgrades abiertos que no han cobrado nada todavía: el negocio
                sigue en su plan anterior hasta que entre el pago.
              </p>
              <ul className="space-y-3 list-none p-0 m-0">
                {data.porPasarela.map((p) => (
                  <li
                    key={p.id}
                    className="rounded-lg bg-bg2/40 border border-line px-3.5 py-3"
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>{negocio(p.tenantId)}</div>
                      <div className="text-xs text-mute">
                        {usd(p.paidAmountUsd)} · esperando{' '}
                        {espera(p.horasEsperando)}
                      </div>
                    </div>
                    {p.barridoNota && (
                      <p className="text-[11px] text-mute leading-relaxed mt-2 mb-0">
                        {p.barridoNota}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

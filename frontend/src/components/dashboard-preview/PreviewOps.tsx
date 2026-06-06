'use client';

/**
 * Preview 2 — OPERACIONES (estilo CRM bandeja).
 * Vista densa: pagos pendientes, trials por vencer, suspendidos, alertas,
 * actividad reciente.
 */

import Link from 'next/link';
import { useMemo } from 'react';
import { EmptyState } from './EmptyState';
import {
  usePreviewData,
  fmtDate,
  daysBetween,
  type TenantRow,
} from './shared';

export function PreviewOps() {
  const { global, tenants, loading } = usePreviewData();

  const now = new Date();

  const pagosPendientes = useMemo(() => {
    if (!tenants) return [];
    return tenants
      .filter((t) => t.status === 'ACTIVE' && t.currentPeriodEnd)
      .map((t) => ({
        ...t,
        days: daysBetween(new Date(t.currentPeriodEnd!), now),
      }))
      .filter((t) => t.days >= -5 && t.days <= 14)
      .sort((a, b) => a.days - b.days)
      .slice(0, 8);
  }, [tenants, now]);

  const porConfirmar = useMemo(() => {
    if (!tenants) return [];
    return tenants
      .filter((t) => t.status === 'TRIAL')
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 6);
  }, [tenants]);

  const trialsPorVencer = useMemo(() => {
    if (!tenants) return [];
    return tenants
      .filter((t) => t.status === 'TRIAL' && t.trialEndsAt)
      .map((t) => ({
        ...t,
        days: daysBetween(new Date(t.trialEndsAt!), now),
      }))
      .filter((t) => t.days <= 3)
      .sort((a, b) => a.days - b.days)
      .slice(0, 6);
  }, [tenants, now]);

  const suspendidos = useMemo(() => {
    if (!tenants) return [];
    return tenants
      .filter((t) => t.status === 'SUSPENDED')
      .sort(
        (a, b) =>
          new Date(b.suspendedAt ?? b.createdAt).getTime() -
          new Date(a.suspendedAt ?? a.createdAt).getTime(),
      )
      .slice(0, 6);
  }, [tenants]);

  // Actividad reciente: últimos 10 tenants creados (proxy de signups).
  // TODO: cuando exista /admin/events o timeline real, reemplazar.
  const actividad = useMemo(() => {
    if (!tenants) return [];
    return [...tenants]
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, 10);
  }, [tenants]);

  if (loading && !tenants) {
    return <EmptyState text="Cargando bandeja operativa…" icon="chart" />;
  }

  return (
    <div className="max-w-7xl">
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-ink">Bandeja de operaciones</h2>
        <p className="text-sm text-mute mt-1">
          Todo lo que requiere atención hoy: cobros, vencimientos, alertas.
        </p>
      </div>

      {/* Alertas importantes */}
      {global && global.expiringSoon > 0 && (
        <div className="mb-4 rounded-xl bg-amber-50 border border-amber-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center text-lg">
            ⚠
          </div>
          <div className="flex-1 text-sm">
            <div className="font-semibold text-amber-900">
              {global.expiringSoon} negocio{global.expiringSoon === 1 ? '' : 's'} sin
              confirmar pago hace más de 3 días
            </div>
            <div className="text-xs text-amber-800/80">
              Revisa pendientes en /admin/tenants.
            </div>
          </div>
          <Link
            href="/admin/tenants"
            className="text-sm font-semibold text-amber-800 hover:underline"
          >
            Revisar →
          </Link>
        </div>
      )}
      {global && global.suspendedTenants > 0 && (
        <div className="mb-4 rounded-xl bg-red-50 border border-red-200 p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-100 text-red-700 flex items-center justify-center text-lg">
            🚫
          </div>
          <div className="flex-1 text-sm">
            <div className="font-semibold text-red-900">
              {global.suspendedTenants} negocios suspendidos requieren
              seguimiento
            </div>
            <div className="text-xs text-red-800/80">
              Contacta para reactivación o churn confirmado.
            </div>
          </div>
        </div>
      )}

      {/* Grid 2 cols en desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section
          title="Pagos próximos a vencer"
          subtitle="Negocios activos con renovación cerca"
          count={pagosPendientes.length}
          empty="No hay pagos próximos a vencer."
          show={pagosPendientes.length > 0}
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-mute font-semibold border-b border-line2">
                <th className="text-left py-2">Negocio</th>
                <th className="text-left py-2">Plan</th>
                <th className="text-right py-2">Vence</th>
                <th className="text-right py-2">Días</th>
              </tr>
            </thead>
            <tbody>
              {pagosPendientes.map((t) => (
                <tr key={t.id} className="border-b border-line2 last:border-0">
                  <td className="py-2">
                    <Link
                      href={`/admin/tenants/${t.id}`}
                      className="font-medium text-ink hover:text-brand"
                    >
                      {t.brandName}
                    </Link>
                  </td>
                  <td className="py-2 text-xs text-mute">
                    {t.planName ?? '—'}
                    {t.planPeriodicity ? ` · ${t.planPeriodicity}` : ''}
                  </td>
                  <td className="py-2 text-right text-xs text-mute">
                    {fmtDate(t.currentPeriodEnd)}
                  </td>
                  <td className="py-2 text-right">
                    <DaysBadge days={t.days} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section
          title="Negocios por confirmar pago"
          subtitle="Trials Hotmart sin confirmación"
          count={porConfirmar.length}
          empty="Todos los negocios están al día."
          show={porConfirmar.length > 0}
        >
          <ul className="divide-y divide-line2">
            {porConfirmar.map((t) => (
              <li
                key={t.id}
                className="py-2.5 flex items-center justify-between gap-3"
              >
                <div>
                  <Link
                    href={`/admin/tenants/${t.id}`}
                    className="font-medium text-ink hover:text-brand"
                  >
                    {t.brandName}
                  </Link>
                  <div className="text-xs text-mute">{t.email ?? 'sin email'}</div>
                </div>
                <span className="badge badge-warn">TRIAL</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Trials próximos a vencer"
          subtitle="≤ 3 días para conversión"
          count={trialsPorVencer.length}
          empty="Sin trials cerca de vencer."
          show={trialsPorVencer.length > 0}
        >
          <ul className="divide-y divide-line2">
            {trialsPorVencer.map((t) => (
              <li
                key={t.id}
                className="py-2.5 flex items-center justify-between gap-3"
              >
                <div>
                  <Link
                    href={`/admin/tenants/${t.id}`}
                    className="font-medium text-ink hover:text-brand"
                  >
                    {t.brandName}
                  </Link>
                  <div className="text-xs text-mute">
                    Vence {fmtDate(t.trialEndsAt)}
                  </div>
                </div>
                <DaysBadge days={t.days} />
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Clientes suspendidos"
          subtitle="Reactivar o confirmar churn"
          count={suspendidos.length}
          empty="Sin suspensiones recientes."
          show={suspendidos.length > 0}
        >
          <ul className="divide-y divide-line2">
            {suspendidos.map((t) => (
              <li
                key={t.id}
                className="py-2.5 flex items-center justify-between gap-3"
              >
                <div>
                  <Link
                    href={`/admin/tenants/${t.id}`}
                    className="font-medium text-ink hover:text-brand"
                  >
                    {t.brandName}
                  </Link>
                  <div className="text-xs text-mute">
                    Suspendido {fmtDate(t.suspendedAt)}
                  </div>
                </div>
                <Link
                  href={`/admin/tenants/${t.id}`}
                  className="text-xs font-semibold text-brand hover:underline"
                >
                  Reactivar →
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {/* Actividad reciente */}
      <div className="mt-4 rounded-xl bg-white border border-line2 p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
              Actividad reciente
            </div>
            <div className="text-base font-bold text-ink mt-0.5">
              Últimos eventos
            </div>
          </div>
        </div>
        {actividad.length === 0 ? (
          <EmptyState text="Sin actividad reciente." />
        ) : (
          <ol className="relative border-l-2 border-line2 ml-2">
            {actividad.map((t) => (
              <li key={t.id} className="ml-4 mb-3 last:mb-0">
                <span
                  className={`absolute -left-[7px] w-3 h-3 rounded-full border-2 border-white ${
                    t.status === 'ACTIVE'
                      ? 'bg-ok'
                      : t.status === 'TRIAL'
                      ? 'bg-warn'
                      : t.status === 'SUSPENDED'
                      ? 'bg-bad'
                      : 'bg-mute'
                  }`}
                />
                <div className="text-sm">
                  <Link
                    href={`/admin/tenants/${t.id}`}
                    className="font-medium text-ink hover:text-brand"
                  >
                    {t.brandName}
                  </Link>
                  <span className="text-xs text-mute ml-2">
                    {actividadLabel(t)} · {fmtDate(t.createdAt)}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
        <div className="text-[10px] text-mute mt-2">
          Timeline derivado de tenants.createdAt.{' '}
          {/* TODO: cuando exista /admin/events real, reemplazar. */}
        </div>
      </div>
    </div>
  );
}

function actividadLabel(t: TenantRow) {
  if (t.status === 'ACTIVE') return 'Negocio activado';
  if (t.status === 'TRIAL') return 'Nuevo signup trial';
  if (t.status === 'SUSPENDED') return 'Negocio suspendido';
  return 'Evento';
}

function DaysBadge({ days }: { days: number }) {
  if (days < 0) {
    return (
      <span className="px-2 py-0.5 rounded-pill text-[10px] font-semibold bg-bad-soft text-bad-ink">
        {Math.abs(days)}d vencido
      </span>
    );
  }
  if (days <= 3) {
    return (
      <span className="px-2 py-0.5 rounded-pill text-[10px] font-semibold bg-warn-soft text-warn-ink">
        {days}d
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 rounded-pill text-[10px] font-semibold bg-ok-soft text-ok-ink">
      {days}d
    </span>
  );
}

function Section({
  title,
  subtitle,
  count,
  children,
  empty,
  show,
}: {
  title: string;
  subtitle: string;
  count: number;
  children: React.ReactNode;
  empty: string;
  show: boolean;
}) {
  return (
    <div className="rounded-xl bg-white border border-line2 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
            {title}
          </div>
          <div className="text-base font-bold text-ink mt-0.5">{subtitle}</div>
        </div>
        <span className="text-sm font-semibold text-brand">{count}</span>
      </div>
      {show ? children : <div className="text-sm text-mute py-3">{empty}</div>}
    </div>
  );
}

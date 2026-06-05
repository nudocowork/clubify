'use client';
import Link from 'next/link';
import { useState } from 'react';

/**
 * Preview comparativo de 5 layouts para mostrar los planes de pago de
 * Clubify. Pensado para que el founder elija visualmente antes de
 * reemplazar la página principal y conectar el checkout real.
 *
 * Página NO indexada por buscadores (noindex, nofollow) — es un preview
 * interno. Cuando se elija un diseño se promueve a la home / checkout
 * y este archivo puede borrarse o quedar como histórico.
 *
 * Todos los botones son dummy (href="#"). Cuando se elija el diseño
 * final, el founder configurará los links de pago desde /admin (4
 * settings: pago.mensual, pago.trimestral, pago.semestral, pago.anual).
 */

type Plan = {
  id: 'mensual' | 'trimestral' | 'semestral' | 'anual';
  name: string;
  shortName: string;
  price: number;
  months: number;
  description: string;
};

const PLANS: Plan[] = [
  {
    id: 'mensual',
    name: 'Mensual',
    shortName: '1 mes',
    price: 68,
    months: 1,
    description: 'Sin compromiso. Cancela cuando quieras.',
  },
  {
    id: 'trimestral',
    name: 'Trimestral',
    shortName: '3 meses',
    price: 150,
    months: 3,
    description: 'Pagas cada 3 meses y ahorras frente al mensual.',
  },
  {
    id: 'semestral',
    name: 'Semestral',
    shortName: '6 meses',
    price: 278,
    months: 6,
    description: 'Compromiso de 6 meses con descuento significativo.',
  },
  {
    id: 'anual',
    name: 'Anual',
    shortName: '1 año',
    price: 500,
    months: 12,
    description: 'El mejor precio por mes. 1 año completo de Clubify.',
  },
];

const MENSUAL_PRICE = 68;
const FEATURES_INCLUDED = [
  'Tarjetas Wallet ilimitadas',
  'Menú digital + pedidos por WhatsApp',
  'CRM de clientes y automatizaciones',
  'Soporte por WhatsApp',
];

function perMonth(p: Plan): number {
  return p.price / p.months;
}
function savePerCycle(p: Plan): number {
  return MENSUAL_PRICE * p.months - p.price;
}
function savePerYear(p: Plan): number {
  return MENSUAL_PRICE * 12 - (p.price / p.months) * 12;
}
function fmtUSD(n: number): string {
  return `${Math.round(n)} USD`;
}
function fmtUSDDec(n: number): string {
  return `${(Math.round(n * 10) / 10).toFixed(n % 1 === 0 ? 0 : 1)} USD`;
}

export default function PlanesPreviewPage() {
  return (
    <main className="min-h-screen bg-bg pb-20">
      <div className="bg-ink text-white">
        <div className="max-w-6xl mx-auto px-5 py-8">
          <div className="text-[11px] uppercase tracking-[0.16em] opacity-60">
            Preview interno · 5 propuestas
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold mt-1">
            Planes de Clubify — diseños comparativos
          </h1>
          <p className="opacity-80 text-sm mt-2 max-w-2xl leading-relaxed">
            5 formas distintas de presentar Mensual / Trimestral / Semestral
            / Anual. Botones dummy. Elige el diseño y lo promovemos a la
            página principal con los links de pago reales conectados.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-5 py-10 space-y-16">
        <Preview1Cards />
        <Divider n={2} title="Toggle de periodicidad" />
        <Preview2Toggle />
        <Divider n={3} title="Plan destacado" />
        <Preview3Featured />
        <Divider n={4} title="Tabla comparativa" />
        <Preview4Table />
        <Divider n={5} title="Checkout selector" />
        <Preview5Checkout />
      </div>
    </main>
  );
}

function Divider({ n, title }: { n: number; title: string }) {
  return (
    <div className="border-t border-line2 pt-10 -mb-2">
      <div className="text-[11px] uppercase tracking-[0.16em] text-mute font-semibold">
        Preview {n}
      </div>
      <h2 className="text-xl font-bold mt-0.5">{title}</h2>
    </div>
  );
}

function PreviewHeader({ n, title }: { n: number; title: string }) {
  return (
    <div className="mb-6">
      <div className="text-[11px] uppercase tracking-[0.16em] text-mute font-semibold">
        Preview {n}
      </div>
      <h2 className="text-xl font-bold mt-0.5">{title}</h2>
    </div>
  );
}

// =============================================================
//  PREVIEW 1 — Cards horizontales (4 cards lado a lado)
// =============================================================

function Preview1Cards() {
  return (
    <section>
      <PreviewHeader n={1} title="Cards horizontales" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {PLANS.map((p) => (
          <div
            key={p.id}
            className="bg-white rounded-2xl border border-line2 p-5 flex flex-col"
          >
            <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
              {p.shortName}
            </div>
            <h3 className="text-lg font-bold mt-1">{p.name}</h3>
            <div className="mt-4">
              <div className="text-3xl font-bold">{fmtUSD(p.price)}</div>
              <div className="text-xs text-mute mt-1">
                {p.months === 1
                  ? 'por mes'
                  : `cada ${p.months} meses`}
              </div>
            </div>
            <p className="text-sm text-mute leading-relaxed mt-4 flex-1">
              {p.description}
            </p>
            <Link
              href="#"
              className="mt-5 inline-flex items-center justify-center w-full bg-brand text-white font-semibold py-3 rounded-pill hover:opacity-95 transition active:scale-[0.98]"
            >
              Pagar ahora →
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}

// =============================================================
//  PREVIEW 2 — Toggle de periodicidad (1 card grande)
// =============================================================

function Preview2Toggle() {
  const [active, setActive] = useState<Plan['id']>('anual');
  const plan = PLANS.find((p) => p.id === active)!;
  return (
    <section>
      <PreviewHeader n={2} title="Toggle de periodicidad" />
      <div className="max-w-md mx-auto">
        {/* Selector */}
        <div className="bg-bg2 rounded-pill p-1 flex gap-1">
          {PLANS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setActive(p.id)}
              className={`flex-1 text-xs sm:text-sm font-semibold py-2.5 rounded-pill transition ${
                active === p.id
                  ? 'bg-white text-ink shadow-sm'
                  : 'text-mute hover:text-ink'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>

        {/* Card principal */}
        <div className="mt-5 bg-white rounded-2xl border border-line2 p-6 sm:p-8 text-center">
          <h3 className="text-xl font-bold">{plan.name}</h3>
          <div className="mt-5">
            <div className="text-5xl font-bold">{fmtUSD(plan.price)}</div>
            <div className="text-sm text-mute mt-2">
              Equivale a {fmtUSDDec(perMonth(plan))} / mes
            </div>
          </div>
          <p className="text-sm text-mute leading-relaxed mt-4">
            {plan.description}
          </p>
          {savePerCycle(plan) > 0 && (
            <div className="mt-4 inline-flex items-center gap-1.5 bg-brand-soft text-brand text-xs font-semibold px-3 py-1.5 rounded-pill">
              💰 Ahorras {fmtUSD(savePerCycle(plan))} vs el mensual
            </div>
          )}
          <Link
            href="#"
            className="mt-6 inline-flex items-center justify-center w-full bg-brand text-white font-semibold py-3.5 rounded-pill hover:opacity-95 transition active:scale-[0.98]"
          >
            Pagar ahora →
          </Link>
          <div className="mt-3 text-[11px] text-mute">
            Activación inmediata. Cancela cuando quieras.
          </div>
        </div>
      </div>
    </section>
  );
}

// =============================================================
//  PREVIEW 3 — Plan destacado
// =============================================================

function Preview3Featured() {
  const featured: Plan['id'] = 'anual';
  return (
    <section>
      <PreviewHeader n={3} title="Plan destacado" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-stretch">
        {PLANS.map((p) => {
          const isFeatured = p.id === featured;
          const save = savePerYear(p);
          return (
            <div
              key={p.id}
              className={`relative rounded-2xl p-5 flex flex-col ${
                isFeatured
                  ? 'bg-ink text-white border-2 border-brand shadow-xl scale-[1.02] lg:scale-105 z-10'
                  : 'bg-white border border-line2'
              }`}
            >
              {isFeatured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-pill shadow-md whitespace-nowrap">
                  ⭐ Más recomendado
                </div>
              )}
              <div
                className={`text-[11px] uppercase tracking-wider font-semibold ${
                  isFeatured ? 'opacity-70' : 'text-mute'
                }`}
              >
                {p.shortName}
              </div>
              <h3 className="text-lg font-bold mt-1">{p.name}</h3>
              <div className="mt-4">
                <div className="text-3xl font-bold">{fmtUSD(p.price)}</div>
                <div
                  className={`text-xs mt-1 ${
                    isFeatured ? 'opacity-80' : 'text-mute'
                  }`}
                >
                  {fmtUSDDec(perMonth(p))} / mes
                </div>
              </div>
              {save > 0 && (
                <div
                  className={`mt-3 inline-block text-xs font-semibold px-2.5 py-1 rounded-full self-start ${
                    isFeatured
                      ? 'bg-brand/20 text-white'
                      : 'bg-brand-soft text-brand'
                  }`}
                >
                  Ahorras {fmtUSD(save)} / año
                </div>
              )}
              <ul
                className={`mt-4 space-y-1.5 text-xs leading-relaxed flex-1 ${
                  isFeatured ? 'opacity-90' : 'text-mute'
                }`}
              >
                {FEATURES_INCLUDED.slice(0, 3).map((f) => (
                  <li key={f} className="flex items-start gap-1.5">
                    <span className="text-brand">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="#"
                className={`mt-5 inline-flex items-center justify-center w-full font-semibold py-3 rounded-pill transition active:scale-[0.98] ${
                  isFeatured
                    ? 'bg-brand text-white hover:opacity-95'
                    : 'bg-bg2 text-ink hover:bg-line2'
                }`}
              >
                {isFeatured ? 'Elegir plan ⭐' : 'Elegir plan'}
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// =============================================================
//  PREVIEW 4 — Tabla comparativa
// =============================================================

function Preview4Table() {
  return (
    <section>
      <PreviewHeader n={4} title="Tabla comparativa" />
      <div className="bg-white rounded-2xl border border-line2 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg2 text-left text-mute text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 font-semibold">Plan</th>
                <th className="px-4 py-3 font-semibold">Precio</th>
                <th className="px-4 py-3 font-semibold">
                  Equivale / mes
                </th>
                <th className="px-4 py-3 font-semibold">Beneficio</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {PLANS.map((p, idx) => {
                const save = savePerCycle(p);
                const benefit =
                  p.id === 'mensual'
                    ? 'Sin compromiso'
                    : p.id === 'trimestral'
                    ? `Ahorras ${fmtUSD(save)} en el ciclo`
                    : p.id === 'semestral'
                    ? `Ahorras ${fmtUSD(save)} en el ciclo`
                    : `Ahorras ${fmtUSD(save)} / año`;
                const isLast = idx === PLANS.length - 1;
                return (
                  <tr
                    key={p.id}
                    className={`${
                      isLast ? 'bg-brand-soft/40' : ''
                    } border-t border-line2`}
                  >
                    <td className="px-4 py-4">
                      <div className="font-bold">{p.name}</div>
                      <div className="text-[11px] text-mute">{p.shortName}</div>
                    </td>
                    <td className="px-4 py-4 font-semibold">{fmtUSD(p.price)}</td>
                    <td className="px-4 py-4 text-mute">
                      {fmtUSDDec(perMonth(p))}
                    </td>
                    <td className="px-4 py-4 text-xs">{benefit}</td>
                    <td className="px-4 py-4 text-right">
                      <Link
                        href="#"
                        className={`inline-flex items-center text-xs font-semibold px-4 py-2 rounded-pill transition active:scale-[0.97] ${
                          isLast
                            ? 'bg-brand text-white hover:opacity-95'
                            : 'bg-bg2 text-ink hover:bg-line2'
                        }`}
                      >
                        Pagar →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="text-[11px] text-mute mt-3 text-center">
        Equivalente mensual aproximado · IVA no incluido
      </div>
    </section>
  );
}

// =============================================================
//  PREVIEW 5 — Checkout selector
// =============================================================

function Preview5Checkout() {
  const [selected, setSelected] = useState<Plan['id']>('anual');
  const plan = PLANS.find((p) => p.id === selected)!;
  return (
    <section>
      <PreviewHeader n={5} title="Checkout selector" />
      <div className="max-w-md mx-auto bg-white rounded-2xl border border-line2 p-5 sm:p-6">
        <h3 className="text-base font-bold">Elige tu plan</h3>
        <p className="text-xs text-mute mt-1">
          Pago seguro · activación inmediata.
        </p>
        <div className="mt-5 space-y-2.5">
          {PLANS.map((p) => {
            const active = selected === p.id;
            const save = savePerCycle(p);
            return (
              <label
                key={p.id}
                className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition ${
                  active
                    ? 'border-brand bg-brand-soft/40'
                    : 'border-line2 bg-white hover:bg-bg2/40'
                }`}
              >
                <input
                  type="radio"
                  name="plan"
                  className="sr-only"
                  checked={active}
                  onChange={() => setSelected(p.id)}
                />
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-none ${
                    active ? 'border-brand' : 'border-line2'
                  }`}
                >
                  {active && (
                    <div className="w-2.5 h-2.5 rounded-full bg-brand" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm flex items-center gap-2">
                    {p.name}
                    {p.id === 'anual' && (
                      <span className="text-[9px] uppercase tracking-wider font-bold bg-brand text-white px-1.5 py-0.5 rounded">
                        Mejor precio
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-mute mt-0.5">
                    {fmtUSDDec(perMonth(p))} / mes
                    {save > 0 && (
                      <>
                        {' '}· <span className="text-brand font-semibold">
                          ahorras {fmtUSD(save)}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="font-bold text-base flex-none">
                  {fmtUSD(p.price)}
                </div>
              </label>
            );
          })}
        </div>

        <div className="mt-5 pt-5 border-t border-line2">
          <div className="flex justify-between items-baseline mb-3">
            <span className="text-sm text-mute">Total hoy</span>
            <span className="text-2xl font-bold">{fmtUSD(plan.price)}</span>
          </div>
          <Link
            href="#"
            className="inline-flex items-center justify-center w-full bg-brand text-white font-semibold py-3.5 rounded-pill hover:opacity-95 transition active:scale-[0.98]"
          >
            Continuar al pago →
          </Link>
          <div className="text-center text-[11px] text-mute mt-3">
            🔒 Pago seguro vía Hotmart · Garantía 7 días
          </div>
        </div>
      </div>
    </section>
  );
}

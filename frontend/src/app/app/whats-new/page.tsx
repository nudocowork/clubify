'use client';
import { useEffect } from 'react';
import Link from 'next/link';

type Entry = {
  date: string;
  version: string;
  highlights: { emoji: string; title: string; body: string; href?: string }[];
  fixes?: string[];
};

const CHANGELOG: Entry[] = [
  {
    date: '2026-05-04',
    version: 'v3.6',
    highlights: [
      {
        emoji: '🍳',
        title: 'Modo cocina TV',
        body: 'Vista full-screen del kanban para colgar en una pantalla de cocina. Cards en rojo si un pedido lleva mucho tiempo, atajo F para fullscreen, ESC para salir.',
        href: '/app/orders/display',
      },
      {
        emoji: '🖨',
        title: 'QR Menú imprimible',
        body: 'Generador de poster A4 para imprimir y poner en mesas. 4 templates visuales, 4 mensajes preset y opción de número de mesa.',
        href: '/app/marketing/qr-menu',
      },
      {
        emoji: '📦',
        title: 'Control de inventario',
        body: 'Ahora puedes activar stock por producto. Cada pedido descuenta automáticamente y si llega a 0, el producto se oculta del menú.',
        href: '/app/menu',
      },
      {
        emoji: '⚠️',
        title: 'Alertas de stock en el dashboard',
        body: 'Te avisamos cuando algún producto está agotado o por agotarse según tu umbral.',
        href: '/app',
      },
      {
        emoji: '🗺',
        title: 'Mapa real en ubicaciones',
        body: 'Cada ubicación ahora muestra un mini-mapa de OpenStreetMap con marcador. Botón "🧭 Ir" para abrir cómo llegar en Google Maps.',
        href: '/app/locations',
      },
      {
        emoji: '⏱',
        title: 'Métricas de tiempo en pedidos',
        body: 'En la cabecera del kanban verás el tiempo promedio de preparación y cuántos pedidos van retrasados (>15 min).',
        href: '/app/orders',
      },
    ],
  },
  {
    date: '2026-05-03',
    version: 'v3.5',
    highlights: [
      {
        emoji: '🎨',
        title: 'Landing renovado',
        body: 'Página principal rediseñada inspirada en humand.co: hero asimétrico con mockup, logos de negocios, stats, testimonios.',
        href: '/',
      },
      {
        emoji: '📥',
        title: 'Importar clientes desde CSV',
        body: 'Sube tu Excel/Sheets y mapea las columnas. Si el cliente ya existe (mismo teléfono/email), lo actualizamos en vez de duplicar.',
        href: '/app/customers',
      },
      {
        emoji: '🧾',
        title: 'Recibo cliente A5',
        body: 'En el detalle de pedido ahora puedes elegir entre imprimir ticket cocina (80mm térmico) o recibo formal A5 con marca.',
      },
      {
        emoji: '👁',
        title: 'Vista previa en vivo del storefront',
        body: 'En el editor de Mi sitio, toggle "En vivo" para ver tu sitio real en el iPhone preview.',
        href: '/app/storefront',
      },
      {
        emoji: '?',
        title: 'Panel de ayuda',
        body: 'Botón flotante "?" abajo a la derecha con FAQs buscables, organizadas por categoría.',
      },
      {
        emoji: '🎂',
        title: 'Insights de cumpleaños',
        body: 'Te avisamos cuáles clientes cumplen esta semana — perfecto para enviar saludo o cupón.',
        href: '/app',
      },
      {
        emoji: '🔔',
        title: 'Notas y tags por cliente',
        body: 'Agrega tags inline (VIP, Vegano, Sin gluten…) y notas internas que solo ve tu equipo.',
        href: '/app/customers',
      },
      {
        emoji: '📋',
        title: 'Feed de actividad reciente',
        body: 'En el dashboard ves los últimos pedidos, sellos otorgados, pases emitidos y clientes nuevos en un solo lugar.',
        href: '/app',
      },
    ],
  },
  {
    date: '2026-05-02',
    version: 'v3.4',
    highlights: [
      {
        emoji: '⌘',
        title: 'Command Palette ⌘K',
        body: 'Atajo para saltar a cualquier página o ejecutar una acción rápida. Busca también clientes en vivo escribiendo su nombre.',
      },
      {
        emoji: '🥁',
        title: 'Sonido + flash en pedidos nuevos',
        body: 'Cuando entra un pedido al kanban suena un beep y la card pulsa en color brand. Toggle 🔔 ON/OFF en el header.',
        href: '/app/orders',
      },
      {
        emoji: '🤝',
        title: 'Drag & drop entre columnas',
        body: 'Arrastra una tarjeta de pedido entre Confirmado / Listo / Entregado para cambiar el estado.',
        href: '/app/orders',
      },
      {
        emoji: '👥',
        title: 'Segmentos en lista de clientes',
        body: 'Chips: Todos · Nuevos 7d · VIP · Recurrentes · Sin tarjeta · Inactivos 30d. Búsqueda live.',
        href: '/app/customers',
      },
      {
        emoji: '📣',
        title: 'Campañas WhatsApp masivas',
        body: 'Selecciona varios clientes y manda un mensaje con plantilla {{nombre}} — abre el chat con cada uno.',
      },
      {
        emoji: '🧠',
        title: 'Insights accionables',
        body: '10 reglas que detectan: pedidos retrasados, trial por vencer, sin tarjeta de fidelización, caída de ventas, clientes recurrentes sin tarjeta…',
      },
    ],
  },
  {
    date: '2026-05-01',
    version: 'v3.3',
    highlights: [
      {
        emoji: '🚀',
        title: 'Signup público + trial 10 días',
        body: 'Cualquiera puede crear cuenta desde el landing y arrancar gratis 10 días.',
      },
      {
        emoji: '💸',
        title: 'Pricing en moneda local',
        body: 'El landing detecta tu país por IP y muestra el precio equivalente al cambio del día.',
      },
      {
        emoji: '🤖',
        title: 'Hotmart webhook listo',
        body: 'Scaffolding completo para activar suscripciones automáticas vía Hotmart. Solo falta configurar las env vars.',
      },
    ],
  },
];

const SEEN_KEY = 'clubify:whatsnew:seen';

export default function WhatsNewPage() {
  // Marcar como leído al visitar
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(SEEN_KEY, CHANGELOG[0].version);
    }
  }, []);

  return (
    <div className="max-w-3xl">
      <div className="page-head">
        <h1 className="page-title">Novedades</h1>
        <Link href="/app" className="btn-ghost text-sm">
          ← Dashboard
        </Link>
      </div>

      <div className="space-y-8">
        {CHANGELOG.map((entry, idx) => (
          <div key={entry.version} className="relative">
            {/* Timeline line */}
            {idx < CHANGELOG.length - 1 && (
              <div
                className="absolute left-3 top-10 bottom-0 w-px bg-line"
                aria-hidden
              />
            )}
            <div className="flex items-start gap-4">
              <div
                className={`w-6 h-6 rounded-full flex-none mt-1 flex items-center justify-center text-[10px] font-bold ${
                  idx === 0
                    ? 'bg-brand text-white'
                    : 'bg-bg2 text-mute border border-line'
                }`}
              >
                {idx === 0 ? '✦' : ''}
              </div>
              <div className="flex-1 min-w-0 pb-4">
                <div className="flex items-baseline gap-3 flex-wrap mb-1">
                  <h2 className="text-lg font-bold tracking-tight m-0">
                    {entry.version}
                  </h2>
                  <span className="text-xs text-mute">
                    {new Date(entry.date).toLocaleDateString('es-CO', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </span>
                  {idx === 0 && (
                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-ok-soft text-ok font-semibold">
                      Más reciente
                    </span>
                  )}
                </div>
                <div className="grid gap-2 mt-3">
                  {entry.highlights.map((h, i) => {
                    const inner = (
                      <div className="card card-pad hover:shadow-md transition flex items-start gap-3">
                        <div className="text-2xl flex-none">{h.emoji}</div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-sm">{h.title}</div>
                          <div className="text-xs text-mute mt-1 leading-relaxed">
                            {h.body}
                          </div>
                          {h.href && (
                            <div className="text-xs text-brand mt-1.5">
                              Ir →
                            </div>
                          )}
                        </div>
                      </div>
                    );
                    return h.href ? (
                      <Link key={i} href={h.href}>
                        {inner}
                      </Link>
                    ) : (
                      <div key={i}>{inner}</div>
                    );
                  })}
                </div>
                {entry.fixes && entry.fixes.length > 0 && (
                  <details className="mt-3 text-xs text-mute">
                    <summary className="cursor-pointer hover:text-ink font-semibold">
                      🔧 Mejoras menores
                    </summary>
                    <ul className="mt-2 space-y-1 pl-4 list-disc">
                      {entry.fixes.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="text-center text-xs text-mute mt-10">
        ¿Sugerencias? Escríbenos por{' '}
        <a
          href="https://wa.me/573000000000"
          target="_blank"
          rel="noreferrer"
          className="text-brand hover:underline"
        >
          WhatsApp
        </a>
        .
      </div>
    </div>
  );
}

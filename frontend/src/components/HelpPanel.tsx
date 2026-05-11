'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Icon } from './Icon';

type FAQ = {
  q: string;
  a: string;
  category: 'Empezar' | 'Pedidos' | 'Tarjetas' | 'Cuenta' | 'Sitio' | 'Pago';
  href?: string;
};

const FAQS: FAQ[] = [
  {
    category: 'Empezar',
    q: '¿Cómo creo mi primer producto?',
    a: 'Ve a Menú → "Nuevo producto". Necesitas nombre, precio y categoría. La foto es opcional pero recomendada.',
    href: '/app/menu',
  },
  {
    category: 'Empezar',
    q: '¿Cómo personalizo mi sitio público?',
    a: 'En "Mi sitio" puedes editar descripción, hero, dominio y reordenar bloques arrastrándolos. El cambio se ve en cuanto le das "Publicar".',
    href: '/app/storefront',
  },
  {
    category: 'Empezar',
    q: '¿Cómo invito a mi cajero o staff?',
    a: 'Ve a Equipo de trabajo → "Invitar al equipo". Generamos una contraseña temporal. Puedes mandársela por WhatsApp.',
    href: '/app/staff',
  },
  {
    category: 'Pedidos',
    q: '¿Cómo me llegan los pedidos?',
    a: 'Aparecen en tiempo real en el kanban de "Pedidos". También suena un beep y, si tienes la pestaña en otra ventana, sale notificación del navegador.',
    href: '/app/orders',
  },
  {
    category: 'Pedidos',
    q: '¿Puedo silenciar el sonido de pedidos?',
    a: 'Sí. En la cabecera del kanban hay un toggle "🔔 Sonido ON / OFF". La preferencia se guarda en este dispositivo.',
  },
  {
    category: 'Pedidos',
    q: '¿Cómo imprimo el ticket de cocina?',
    a: 'Abre el detalle del pedido y pulsa "🖨 Imprimir". Sale un ticket compacto pensado para impresoras térmicas 80mm.',
  },
  {
    category: 'Pedidos',
    q: '¿Puedo arrastrar un pedido entre columnas?',
    a: 'Sí. Sostén click en una tarjeta y arrástrala a otra columna del kanban (Confirmado / Listo / Entregado). El estado se actualiza al instante.',
  },
  {
    category: 'Tarjetas',
    q: '¿Apple Wallet o Google Wallet?',
    a: 'Soportamos las dos. Cuando emites un pase, el cliente abre el link y elige guardar en su wallet. Funciona en iPhone y Android sin instalar app.',
  },
  {
    category: 'Tarjetas',
    q: '¿Cómo sumo un sello desde caja?',
    a: 'Dos formas: 1) /scan escanea el código del cliente, 2) Desde el detalle del cliente, botón "+ Sumar sello" en su tarjeta.',
    href: '/scan',
  },
  {
    category: 'Tarjetas',
    q: '¿Puedo emitir tarjeta a varios clientes a la vez?',
    a: 'Por ahora se emite cliente por cliente desde el detalle de la tarjeta. Pronto: emisión masiva por segmento.',
  },
  {
    category: 'Sitio',
    q: '¿Puedo usar mi propio dominio?',
    a: 'Sí. En "Mi sitio" → "Dominio propio" pones tu dominio y agregas un CNAME en tu DNS. Te ayudamos por WhatsApp si te trabas.',
    href: '/app/storefront',
  },
  {
    category: 'Sitio',
    q: '¿Cómo comparto mi link público?',
    a: 'En el dashboard tienes un acceso directo. También está visible al final de Mi sitio. Lo puedes pegar en Instagram bio, WhatsApp, etc.',
  },
  {
    category: 'Cuenta',
    q: '¿Cómo cambio mi contraseña?',
    a: 'Ve a "Mi cuenta" → "Cambiar contraseña". Necesitas la actual.',
    href: '/app/settings',
  },
  {
    category: 'Cuenta',
    q: '¿Cómo descargo todos mis datos?',
    a: '"Mi cuenta" → "Descargar mis datos (JSON)". Incluye clientes, productos, pedidos, tarjetas, todo.',
    href: '/app/settings',
  },
  {
    category: 'Pago',
    q: '¿Cuándo me cobran?',
    a: 'Se cobra al crear la cuenta vía Hotmart (USD 50/mes para Elite, USD 99/mes para Pro, equivalente al cambio del día en tu moneda local). Apenas se aprueba el pago entras al panel. La suscripción se renueva mensualmente hasta que canceles desde tu panel.',
    href: '/app/billing',
  },
  {
    category: 'Pago',
    q: '¿Qué pasa si mi tarjeta falla?',
    a: 'Te avisamos, intentamos 3 veces más en días distintos. Si después de eso no se cobra, suspendemos la cuenta. Tus datos se conservan 30 días por si vuelves.',
  },
  {
    category: 'Pago',
    q: '¿Puedo cambiar de plan?',
    a: 'Sí. Plan Elite (USD 50) o Pro (USD 99 con automatizaciones WhatsApp). Cambias en /app/billing y te ajustamos en Hotmart.',
    href: '/app/billing',
  },
];

const CATEGORIES: FAQ['category'][] = [
  'Empezar',
  'Pedidos',
  'Tarjetas',
  'Sitio',
  'Cuenta',
  'Pago',
];

export function HelpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-30 bg-brand text-white w-12 h-12 rounded-full shadow-lg hover:shadow-xl transition flex items-center justify-center text-lg"
        title="Ayuda y FAQ"
        aria-label="Abrir ayuda"
      >
        ?
      </button>
      <HelpPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function HelpPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<FAQ['category'] | 'Todos'>('Todos');

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return FAQS.filter((f) => {
      if (cat !== 'Todos' && f.category !== cat) return false;
      if (!term) return true;
      return (
        f.q.toLowerCase().includes(term) || f.a.toLowerCase().includes(term)
      );
    });
  }, [q, cat]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="absolute inset-0 bg-ink/50 transition-opacity"
        onClick={onClose}
      />
      <div className="ml-auto relative h-full w-full max-w-md bg-white shadow-2xl flex flex-col">
        <div className="px-5 py-4 border-b border-line2 flex items-center justify-between">
          <div>
            <div className="font-bold text-lg">Ayuda</div>
            <div className="text-xs text-mute">Preguntas frecuentes</div>
          </div>
          <button
            onClick={onClose}
            className="text-mute hover:text-ink text-xl"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="px-5 py-3 border-b border-line2 space-y-2.5">
          <div className="flex items-center gap-2 bg-bg2 rounded-pill px-3 py-1.5">
            <Icon name="search" size={14} className="text-mute" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar pregunta…"
              className="border-0 outline-none text-sm flex-1 bg-transparent"
            />
            {q && (
              <button
                onClick={() => setQ('')}
                className="text-mute hover:text-ink text-sm"
              >
                ✕
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {(['Todos', ...CATEGORIES] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCat(c as any)}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-full border ${
                  cat === c
                    ? 'bg-brand text-white border-brand'
                    : 'bg-white text-mute border-line hover:border-brand/40'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 py-3">
          {filtered.length === 0 ? (
            <div className="text-center py-10">
              <div className="text-3xl mb-1">🤔</div>
              <div className="text-sm font-semibold">Sin resultados</div>
              <p className="text-xs text-mute mt-1">
                Intenta otra palabra o contáctanos directo.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((f, i) => (
                <details
                  key={i}
                  className="rounded-lg border border-line2 group"
                >
                  <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium hover:bg-bg2/50 list-none flex items-center justify-between">
                    <span className="flex-1 pr-3">{f.q}</span>
                    <span className="text-mute group-open:rotate-180 transition">
                      ▾
                    </span>
                  </summary>
                  <div className="px-3 pb-3 text-sm text-mute leading-relaxed">
                    {f.a}
                    {f.href && (
                      <div className="mt-2">
                        <Link
                          href={f.href}
                          onClick={onClose}
                          className="text-xs text-brand hover:underline"
                        >
                          Ir a la sección →
                        </Link>
                      </div>
                    )}
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-line2 bg-bg2/40 text-xs">
          <div className="text-mute mb-2">¿No encuentras tu respuesta?</div>
          <div className="flex gap-2">
            <a
              href="https://wa.me/573000000000"
              target="_blank"
              rel="noreferrer"
              className="flex-1 inline-flex items-center justify-center gap-1.5 bg-ok text-white font-semibold px-3 py-2 rounded-pill text-xs hover:bg-ok/90"
            >
              <Icon name="send" size={12} /> WhatsApp soporte
            </a>
            <a
              href="mailto:hola@soyclubify.com"
              className="flex-1 inline-flex items-center justify-center gap-1.5 bg-bg2 text-ink font-semibold px-3 py-2 rounded-pill text-xs hover:bg-line"
            >
              ✉ Email
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

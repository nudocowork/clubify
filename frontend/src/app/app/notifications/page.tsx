'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { EmojiPicker } from '@/components/EmojiPicker';

// =============================================================
//                    Plantillas predefinidas
// =============================================================

type Template = { id: string; title: string; body: string };
type TemplateGroup = {
  id: 'special_days' | 'remarketing';
  emoji: string;
  name: string;
  description: string;
  items: Template[];
};

const TEMPLATE_GROUPS: TemplateGroup[] = [
  {
    id: 'special_days',
    emoji: '🎉',
    name: 'Días especiales',
    description: 'Mensajes para fechas memorables del año.',
    items: [
      {
        id: 'birthday',
        title: '🎂 ¡Feliz cumpleaños!',
        body: 'Hoy te invitamos algo especial de la casa. Pasa cuando quieras.',
      },
      {
        id: 'anniversary',
        title: '🎉 Aniversario del local',
        body: '¡Estamos celebrando! Hoy 30% off en todo. Gracias por acompañarnos.',
      },
      {
        id: 'fathers_day',
        title: '👨‍👧 Día del padre',
        body: 'Trae a papá hoy y le invitamos su pedido favorito.',
      },
      {
        id: 'mothers_day',
        title: '💐 Día de la madre',
        body: 'Postre gratis para mamá hoy. ¡Pasa con ella!',
      },
      {
        id: 'black_friday',
        title: '🛍 Black Friday',
        body: '30% off en todo el menú solo hoy. Escanea tu tarjeta para activar.',
      },
      {
        id: 'christmas',
        title: '🎄 ¡Feliz Navidad!',
        body: 'Hoy sumas 2 sellos extra en tu tarjeta. Felices fiestas.',
      },
      {
        id: 'new_year',
        title: '🎆 Año nuevo, sellos nuevos',
        body: 'Empieza el año con 3 sellos de regalo en tu tarjeta de fidelidad.',
      },
    ],
  },
  {
    id: 'remarketing',
    emoji: '🎯',
    name: 'Remarketing',
    description: 'Reactiva clientes y avisa sobre promos puntuales.',
    items: [
      {
        id: 'inactive_30d',
        title: 'Te extrañamos',
        body: 'Hace tiempo no te vemos por acá. Vuelve esta semana y te regalamos 2 sellos extra.',
      },
      {
        id: 'flash_promo',
        title: '🔥 Solo hoy',
        body: '2x1 en bebidas calientes hasta las 6pm. Pasa y muestra esta tarjeta.',
      },
      {
        id: 'reward_ready',
        title: '⭐ Tu recompensa te espera',
        body: 'Llegaste al tope de sellos. Pasa a reclamar tu producto gratis.',
      },
      {
        id: 'first_purchase',
        title: '🤝 Gracias por tu primera visita',
        body: 'Te llevas 1 sello extra de cortesía en tu próxima compra. ¡Te esperamos!',
      },
      {
        id: 'monthly_reminder',
        title: '📅 ¿Cuándo es la próxima?',
        body: 'Te están esperando sellos nuevos. ¡Pasa cuando quieras!',
      },
      {
        id: 'menu_update',
        title: '🆕 Nuevo en el menú',
        body: 'Sumamos productos nuevos esta semana. Ven a probarlos.',
      },
    ],
  },
];

// =============================================================
//                          Página
// =============================================================

export default function NotificationsPage() {
  const [history, setHistory] = useState<any[]>([]);
  const [cards, setCards] = useState<any[]>([]);
  const [form, setForm] = useState({ cardId: '', title: '', body: '' });
  const [sending, setSending] = useState(false);
  const [activeGroup, setActiveGroup] = useState<TemplateGroup['id']>(
    'special_days',
  );

  function appendEmoji(field: 'title' | 'body', emoji: string) {
    setForm((f) => ({ ...f, [field]: (f[field] || '') + emoji }));
  }

  async function load() {
    try {
      const [h, c] = await Promise.all([api('/notifications'), api('/cards')]);
      setHistory(h as any[]);
      setCards(c as any[]);
    } catch (e: any) {
      toast(e.message || 'Error cargando notificaciones', 'error');
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      await api('/notifications', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          cardId: form.cardId || undefined,
        }),
      });
      setForm({ cardId: '', title: '', body: '' });
      load();
      toast('Notificación enviada', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo enviar', 'error');
    } finally {
      setSending(false);
    }
  }

  function applyTemplate(t: Template) {
    setForm((f) => ({ ...f, title: t.title, body: t.body }));
    if (typeof window !== 'undefined')
      window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('Plantilla cargada · editá lo que quieras antes de enviar', 'info');
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Notificaciones push{' '}
          <span className="page-crumb">/ {history.length} enviadas</span>
        </h1>
        <Link
          href="/app/locations"
          className="btn-ghost"
          title="Configura ubicaciones para que las tarjetas wallet se activen automáticamente cuando el cliente esté cerca del local"
        >
          📍 Ubicación
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-5">
        {/* Composer */}
        <form onSubmit={send} className="card card-pad self-start">
          <h2 className="text-base font-semibold m-0">Nueva notificación</h2>
          <div className="mt-4">
            <label className="label">Tarjeta (opcional)</label>
            <select
              className="input"
              value={form.cardId}
              onChange={(e) => setForm({ ...form, cardId: e.target.value })}
            >
              <option value="">Todas las tarjetas</option>
              {cards
                .filter((c) => c.name && c.name.trim().length > 0)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="mt-3">
            <label className="label">Título</label>
            <div className="flex items-stretch gap-2">
              <input
                className="input flex-1"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                maxLength={64}
                placeholder="Ej: Promo de fin de semana"
              />
              <EmojiPicker
                onSelect={(emoji) => appendEmoji('title', emoji)}
                size="sm"
                placeholder="Agregar emoji al título"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="label">Mensaje</label>
            <div className="flex items-start gap-2">
              <textarea
                className="input flex-1"
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                required
                maxLength={200}
                rows={3}
                placeholder="Ej: 2x1 en cafés todo el sábado ☕"
              />
              <EmojiPicker
                onSelect={(emoji) => appendEmoji('body', emoji)}
                size="sm"
                placeholder="Agregar emoji al mensaje"
              />
            </div>
          </div>

          <button
            className="btn-primary mt-4 w-full justify-center"
            disabled={sending}
          >
            <Icon name="send" /> {sending ? 'Enviando…' : 'Enviar'}
          </button>
        </form>

        {/* Plantillas */}
        <div className="card card-pad">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-base font-semibold m-0">📋 Plantillas</h2>
            <span className="text-[11px] text-mute">
              Click → carga al composer
            </span>
          </div>

          {/* Tabs */}
          <div className="flex gap-1.5 flex-wrap mb-3">
            {TEMPLATE_GROUPS.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setActiveGroup(g.id)}
                className={`px-3 py-1.5 rounded-pill text-xs font-semibold transition ${
                  activeGroup === g.id
                    ? 'bg-brand text-white shadow-sm'
                    : 'bg-bg2 text-ink hover:bg-line'
                }`}
              >
                {g.emoji} {g.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setActiveGroup('geopush' as any)}
              className={`px-3 py-1.5 rounded-pill text-xs font-semibold transition ${
                (activeGroup as any) === 'geopush'
                  ? 'bg-brand text-white shadow-sm'
                  : 'bg-bg2 text-ink hover:bg-line'
              }`}
            >
              📍 GeoPush
            </button>
          </div>

          {(activeGroup as any) === 'geopush' ? (
            <div>
              <p className="text-sm text-mute leading-relaxed">
                El <b className="text-ink">GeoPush</b> es el mensaje que
                recibe el cliente en la pantalla de bloqueo de su iPhone
                cuando pasa cerca de tu negocio (Apple Wallet detecta la
                ubicación automáticamente, no necesita app abierta).
              </p>
              <p className="text-sm text-mute mt-2 leading-relaxed">
                Se configura por ubicación desde la sección Ubicaciones —
                cada local puede tener un texto distinto y un radio
                personalizado (300 m por default).
              </p>
              <Link
                href="/app/locations"
                className="btn-primary mt-4 inline-flex"
              >
                <Icon name="pin" /> Ir a Ubicaciones
              </Link>
            </div>
          ) : (
            <>
              {TEMPLATE_GROUPS.find((g) => g.id === activeGroup) && (
                <p className="text-xs text-mute mb-3">
                  {
                    TEMPLATE_GROUPS.find((g) => g.id === activeGroup)!
                      .description
                  }
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {TEMPLATE_GROUPS.find((g) => g.id === activeGroup)?.items.map(
                  (t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => applyTemplate(t)}
                      className="text-left rounded-input border border-line bg-white hover:border-brand/40 hover:bg-brand-soft/40 p-3 transition"
                    >
                      <div className="font-semibold text-sm leading-tight">
                        {t.title}
                      </div>
                      <div className="text-xs text-mute mt-1.5 leading-relaxed line-clamp-3">
                        {t.body}
                      </div>
                    </button>
                  ),
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Historial colapsado */}
      <details className="mt-5 card card-pad">
        <summary className="cursor-pointer flex items-center justify-between">
          <span className="font-semibold text-sm">
            📜 Historial de envíos
          </span>
          <span className="text-xs text-mute">
            {history.length} {history.length === 1 ? 'envío' : 'envíos'}
          </span>
        </summary>
        <div className="mt-3 space-y-2">
          {history.length === 0 ? (
            <div className="text-center py-6 text-sm text-mute">
              <div className="text-2xl mb-1">🔔</div>
              Sin envíos aún. Manda tu primera notificación arriba.
            </div>
          ) : (
            history.map((n) => (
              <div
                key={n.id}
                className="border border-line2 rounded-input px-3 py-2 flex items-start gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-mute">
                    {new Date(n.sentAt ?? n.createdAt).toLocaleString('es-CO', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                  <div className="font-medium text-sm mt-0.5">{n.title}</div>
                  <div className="text-xs text-mute mt-0.5 line-clamp-2">
                    {n.body}
                  </div>
                </div>
                <div className="text-right text-xs text-mute whitespace-nowrap">
                  <div className="font-semibold text-ink">
                    {n.stats?.targeted ?? 0}
                  </div>
                  <div className="text-[10px]">enviados</div>
                </div>
              </div>
            ))
          )}
        </div>
      </details>
    </div>
  );
}

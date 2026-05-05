'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';

// Emojis sugeridos para usar en notificaciones push (clickeables)
const PUSH_EMOJIS = [
  '🎉', '🎁', '☕', '🍕', '⭐', '🔥', '💚', '💙',
  '✨', '💯', '🙌', '👋', '🚨', '⏰', '📣', '🎊',
  '🎂', '❤️', '👀', '💸', '🎯', '🛍️',
];

export default function NotificationsPage() {
  const [history, setHistory] = useState<any[]>([]);
  const [cards, setCards] = useState<any[]>([]);
  const [form, setForm] = useState({ cardId: '', title: '', body: '' });
  const [sending, setSending] = useState(false);
  const [emojiTarget, setEmojiTarget] = useState<'title' | 'body' | null>(null);

  function insertEmoji(emoji: string) {
    if (!emojiTarget) return;
    setForm((f) => ({ ...f, [emojiTarget]: (f[emojiTarget] || '') + emoji }));
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

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Notificaciones push <span className="page-crumb">/ {history.length} enviadas</span>
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <form onSubmit={send} className="card card-pad">
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
            <div className="flex items-center justify-between">
              <label className="label mb-0">Título</label>
              <button
                type="button"
                className="text-[11px] text-brand hover:underline"
                onClick={() => setEmojiTarget(emojiTarget === 'title' ? null : 'title')}
              >
                {emojiTarget === 'title' ? 'Cerrar emojis' : '+ emoji'}
              </button>
            </div>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              onFocus={() => setEmojiTarget('title')}
              required
              maxLength={64}
            />
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between">
              <label className="label mb-0">Mensaje</label>
              <button
                type="button"
                className="text-[11px] text-brand hover:underline"
                onClick={() => setEmojiTarget(emojiTarget === 'body' ? null : 'body')}
              >
                {emojiTarget === 'body' ? 'Cerrar emojis' : '+ emoji'}
              </button>
            </div>
            <textarea
              className="input"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              onFocus={() => setEmojiTarget('body')}
              required
              maxLength={200}
            />
          </div>

          {emojiTarget && (
            <div className="mt-2 p-2 bg-bg2 rounded-input">
              <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1.5">
                Click para agregar al {emojiTarget === 'title' ? 'título' : 'mensaje'}
              </div>
              <div className="grid grid-cols-8 sm:grid-cols-11 gap-1">
                {PUSH_EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => insertEmoji(e)}
                    className="aspect-square text-xl hover:bg-white rounded transition"
                    aria-label={`Agregar ${e}`}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            className="btn-primary mt-4 w-full justify-center"
            disabled={sending}
          >
            <Icon name="send" /> {sending ? 'Enviando…' : 'Enviar'}
          </button>
        </form>

        <div>
          <h2 className="text-base font-semibold m-0 mb-3">Historial</h2>
          <div className="space-y-2.5">
            {history.length === 0 && (
              <div className="card card-pad text-center py-8">
                <div className="text-3xl mb-1">🔔</div>
                <div className="font-semibold text-sm">
                  Sin notificaciones aún
                </div>
                <p className="text-xs text-mute mt-1 max-w-xs mx-auto">
                  Cuando envíes la primera, verás aquí cuántos pases la
                  recibieron.
                </p>
              </div>
            )}
            {history.map((n) => (
              <div key={n.id} className="card card-pad">
                <div className="text-[11px] text-mute">
                  {new Date(n.sentAt ?? n.createdAt).toLocaleString('es-CO')}
                </div>
                <div className="font-semibold mt-0.5">{n.title}</div>
                <div className="text-sm text-mute mt-1">{n.body}</div>
                <div className="mt-2 text-xs text-mute">
                  Targeted: <strong>{n.stats?.targeted ?? 0}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

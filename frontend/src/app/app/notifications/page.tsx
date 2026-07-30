'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { api } from '@/lib/api';
import { AcademyButton } from '@/components/AcademyButton';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { EmojiPicker } from '@/components/EmojiPicker';
import { ImageUploader } from '@/components/ImageUploader';

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
        body: 'Hace tiempo no te vemos por aquí. Vuelve esta semana y te regalamos 2 sellos extra.',
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
  const t = useTranslations('app_notifications');
  const [history, setHistory] = useState<any[]>([]);
  const [cards, setCards] = useState<any[]>([]);
  const [form, setForm] = useState({ cardId: '', title: '', body: '' });
  const [sending, setSending] = useState(false);
  const [activeGroup, setActiveGroup] = useState<TemplateGroup['id']>(
    'special_days',
  );
  const [brandName, setBrandName] = useState<string>('Tu negocio');
  const [brandColor, setBrandColor] = useState<string | null>(null);
  const [brandLogoUrl, setBrandLogoUrl] = useState<string | null>(null);
  // Logo dedicado al banner de notificaciones push (icon.png del .pkpass).
  // Fallback en preview: pushLogo → walletLogo → logoUrl → inicial.
  const [pushLogoUrl, setPushLogoUrl] = useState<string | null>(null);
  const [walletLogoFallback, setWalletLogoFallback] = useState<string | null>(null);
  const [savingPushLogo, setSavingPushLogo] = useState(false);
  // 'now' = envío inmediato (default), 'once' = fecha específica,
  // 'recurring' = patrón semanal (días + hora) que el cron despacha.
  const [scheduleMode, setScheduleMode] = useState<'now' | 'once' | 'recurring'>('now');
  const scheduleEnabled = scheduleMode === 'once';
  const [recDays, setRecDays] = useState<number[]>([1, 2, 3, 4, 5]); // L-V default
  const [recTime, setRecTime] = useState<string>('10:00');
  const [recurring, setRecurring] = useState<any[]>([]);
  // Default: 1h en el futuro, redondeado al próximo cuarto de hora
  const [scheduledAt, setScheduledAt] = useState<string>(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    return localISO(d);
  });
  // Id del envío programado que se está EDITANDO (null = compose normal).
  // Cuando está seteado, el formulario de arriba edita ese envío vía PATCH.
  const [editingScheduledId, setEditingScheduledId] = useState<string | null>(null);

  function appendEmoji(field: 'title' | 'body', emoji: string) {
    setForm((f) => ({ ...f, [field]: (f[field] || '') + emoji }));
  }

  async function load() {
    try {
      const [h, c, me, rec] = await Promise.all([
        api('/notifications'),
        api('/cards'),
        api('/tenants/me').catch(() => null),
        api('/notifications/recurring').catch(() => []),
      ]);
      // FIX 2026-06-16 (review): api() devuelve null en respuestas vacías →
      // history.length/cards.filter/history.map crasheaban. Guarda ?? [].
      setHistory((h as any[]) ?? []);
      setCards((c as any[]) ?? []);
      setRecurring((rec as any[]) ?? []);
      if ((me as any)?.brandName) setBrandName((me as any).brandName);
      if ((me as any)?.primaryColor) setBrandColor((me as any).primaryColor);
      const pushLogo = (me as any)?.pushLogoUrl ?? null;
      const walletLogo = (me as any)?.walletLogoUrl ?? null;
      const generalLogo = (me as any)?.logoUrl ?? null;
      setPushLogoUrl(pushLogo);
      setWalletLogoFallback(walletLogo ?? generalLogo);
      // Preview prioriza pushLogo → wallet → general (mismo fallback que .pkpass icon.png).
      setBrandLogoUrl(pushLogo ?? walletLogo ?? generalLogo);
    } catch (e: any) {
      toast(e.message || t('errorLoading'), 'error');
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      if (scheduleMode === 'recurring') {
        if (recDays.length === 0) {
          toast(t('pickAtLeastOneDay'), 'error');
          setSending(false);
          return;
        }
        if (!/^\d{2}:\d{2}$/.test(recTime)) {
          toast(t('invalidTime'), 'error');
          setSending(false);
          return;
        }
        await api('/notifications/recurring', {
          method: 'POST',
          body: JSON.stringify({
            cardId: form.cardId || undefined,
            title: form.title,
            body: form.body,
            daysOfWeek: recDays,
            timeOfDay: recTime,
          }),
        });
        setForm({ cardId: '', title: '', body: '' });
        load();
        toast(t('recurrenceCreated'), 'success');
        setSending(false);
        return;
      }

      const payload: any = {
        ...form,
        cardId: form.cardId || undefined,
      };
      if (scheduleEnabled) {
        const when = new Date(scheduledAt);
        if (!Number.isFinite(when.getTime())) {
          toast(t('invalidDate'), 'error');
          setSending(false);
          return;
        }
        if (when.getTime() <= Date.now()) {
          toast(t('dateMustBeFuture'), 'error');
          setSending(false);
          return;
        }
        payload.scheduledAt = when.toISOString();
      }

      // Modo edición: PATCH sobre el envío programado existente (título/cuerpo/fecha).
      if (editingScheduledId && scheduleEnabled) {
        await api(`/notifications/${editingScheduledId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            title: payload.title,
            body: payload.body,
            scheduledAt: payload.scheduledAt,
          }),
        });
        setForm({ cardId: '', title: '', body: '' });
        setEditingScheduledId(null);
        load();
        toast(t('scheduledUpdated'), 'success');
        setSending(false);
        return;
      }

      await api('/notifications', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setForm({ cardId: '', title: '', body: '' });
      setEditingScheduledId(null);
      load();
      toast(
        scheduleEnabled
          ? t('notificationScheduledFor', {
              when: new Date(scheduledAt).toLocaleString('es-CO'),
            })
          : t('notificationSent'),
        'success',
      );
    } catch (e: any) {
      toast(e.message || t('couldNotSend'), 'error');
    } finally {
      setSending(false);
    }
  }

  async function toggleRecurring(id: string, next: boolean) {
    try {
      await api(`/notifications/recurring/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: next }),
      });
      load();
      toast(next ? t('recurrenceActivated') : t('recurrencePaused'), 'success');
    } catch (e: any) {
      toast(e.message || t('couldNotChange'), 'error');
    }
  }

  async function deleteRecurring(id: string) {
    if (!confirm(t('confirmDeleteRecurrence'))) return;
    try {
      await api(`/notifications/recurring/${id}`, { method: 'DELETE' });
      load();
      toast(t('recurrenceDeleted'), 'success');
    } catch (e: any) {
      toast(e.message || t('couldNotDelete'), 'error');
    }
  }

  // Cancela un envío programado (fecha única) aún no enviado.
  async function cancelScheduledSend(id: string) {
    if (!confirm(t('confirmCancelSend'))) return;
    try {
      await api(`/notifications/${id}`, { method: 'DELETE' });
      if (editingScheduledId === id) {
        setEditingScheduledId(null);
        setForm({ cardId: '', title: '', body: '' });
      }
      load();
      toast(t('scheduledCanceled'), 'success');
    } catch (e: any) {
      toast(e.message || t('couldNotDelete'), 'error');
    }
  }

  // Carga un envío programado en el formulario de arriba para editarlo.
  function startEditScheduled(n: any) {
    setForm({ cardId: n.cardId || '', title: n.title || '', body: n.body || '' });
    setScheduleMode('once');
    if (n.scheduledAt) setScheduledAt(localISO(new Date(n.scheduledAt)));
    setEditingScheduledId(n.id);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function cancelEditScheduled() {
    setEditingScheduledId(null);
    setForm({ cardId: '', title: '', body: '' });
  }

  // Cambiar de modo mientras se edita un envío programado SALE del modo edición
  // (la edición solo aplica a modo 'once'). Evita el bug de que el botón diga
  // "Guardar cambios" pero, en modo 'now', mande un broadcast inmediato, o que
  // en 'recurring' cree una recurrencia dejando el estado inconsistente. El
  // contenido del formulario se conserva.
  function changeScheduleMode(mode: 'now' | 'once' | 'recurring') {
    if (mode !== 'once' && editingScheduledId) {
      setEditingScheduledId(null);
    }
    setScheduleMode(mode);
  }

  async function savePushLogo(url: string | null) {
    setSavingPushLogo(true);
    try {
      await api('/tenants/me', {
        method: 'PATCH',
        body: JSON.stringify({ pushLogoUrl: url ?? '' }),
      });
      setPushLogoUrl(url);
      setBrandLogoUrl(url ?? walletLogoFallback);
      toast(
        url
          ? t('pushLogoSaved')
          : t('pushLogoRemoved'),
        'success',
      );
    } catch (e: any) {
      toast(e.message || t('couldNotSaveLogo'), 'error');
    } finally {
      setSavingPushLogo(false);
    }
  }

  function applyTemplate(tpl: Template) {
    setForm((f) => ({ ...f, title: tpl.title, body: tpl.body }));
    if (typeof window !== 'undefined')
      window.scrollTo({ top: 0, behavior: 'smooth' });
    // El cumpleaños es el único caso per-persona: aquí se enviaría a TODOS.
    // Avisamos para que use Automatizaciones en su lugar.
    if (tpl.id === 'birthday') {
      toast(
        t('birthdayBroadcastWarning'),
        'info',
      );
      return;
    }
    toast(t('templateLoaded'), 'info');
  }

  // Un envío de fecha única PENDIENTE = tiene scheduledAt y aún no se envió
  // (sentAt null). El backend los guarda en el mismo modelo Notification, así
  // que los separamos aquí: pendientes → sección editable; el resto → historial.
  const scheduledPending = history
    .filter((n: any) => n.scheduledAt && !n.sentAt)
    .sort(
      (a: any, b: any) =>
        new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
    );
  const realHistory = history.filter((n: any) => n.sentAt);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {t('pageTitle')}{' '}
          <span className="page-crumb">{t('sentCrumb', { count: history.length })}</span>
        </h1>
        <Link
          href="/app/locations"
          className="btn-ghost"
          title={t('locationLinkTitle')}
        >
          {t('locationLink')}
        </Link>
        <AcademyButton moduleKey="push" />
      </div>

      <PushLogoCard
        pushLogoUrl={pushLogoUrl}
        fallbackUrl={walletLogoFallback}
        brandName={brandName}
        brandColor={brandColor}
        saving={savingPushLogo}
        onChange={savePushLogo}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px_1.2fr] gap-5">
        {/* Composer */}
        <form onSubmit={send} className="card card-pad self-start">
          <h2 className="text-base font-semibold m-0">{t('newNotification')}</h2>
          <div className="mt-4">
            <label className="label">{t('cardOptional')}</label>
            <select
              className="input"
              value={form.cardId}
              onChange={(e) => setForm({ ...form, cardId: e.target.value })}
            >
              <option value="">{t('allCards')}</option>
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
            <label className="label">{t('titleLabel')}</label>
            <div className="flex items-stretch gap-2">
              <input
                className="input flex-1"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                maxLength={64}
                placeholder={t('titlePlaceholder')}
              />
              <EmojiPicker
                onSelect={(emoji) => appendEmoji('title', emoji)}
                size="sm"
                placeholder={t('addEmojiTitle')}
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="label">{t('messageLabel')}</label>
            <div className="flex items-start gap-2">
              <textarea
                className="input flex-1"
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                required
                maxLength={200}
                rows={3}
                placeholder={t('messagePlaceholder')}
              />
              <EmojiPicker
                onSelect={(emoji) => appendEmoji('body', emoji)}
                size="sm"
                placeholder={t('addEmojiMessage')}
              />
            </div>
          </div>

          {/* Selector de modo: inmediato / fecha / recurrente */}
          <div className="mt-4 border-t border-line pt-3">
            <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-2">
              {t('whenToSend')}
            </div>
            <div className="grid grid-cols-3 gap-1 bg-bg2 rounded-lg p-1">
              {([
                { v: 'now' as const, label: t('modeNow') },
                { v: 'once' as const, label: t('modeDate') },
                { v: 'recurring' as const, label: t('modeRecurring') },
              ]).map((opt) => {
                const active = scheduleMode === opt.v;
                return (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => changeScheduleMode(opt.v)}
                    className={`text-xs font-semibold py-2 px-2 rounded-md transition ${
                      active ? 'bg-white text-ink shadow-sm' : 'text-mute hover:text-ink'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {scheduleMode === 'once' && (
              <div className="mt-2.5">
                <input
                  type="datetime-local"
                  className="input"
                  value={scheduledAt}
                  min={localISO(new Date())}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
                <p className="text-[11px] text-mute mt-1.5 leading-relaxed">
                  {t('onceHint')}
                </p>
              </div>
            )}
            {scheduleMode === 'recurring' && (
              <div className="mt-2.5 space-y-3">
                <div>
                  <label className="label">{t('daysOfWeek')}</label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {([
                      { v: 1, label: t('dayShortMon') },
                      { v: 2, label: t('dayShortTue') },
                      { v: 3, label: t('dayShortWed') },
                      { v: 4, label: t('dayShortThu') },
                      { v: 5, label: t('dayShortFri') },
                      { v: 6, label: t('dayShortSat') },
                      { v: 0, label: t('dayShortSun') },
                    ]).map((d) => {
                      const active = recDays.includes(d.v);
                      return (
                        <button
                          key={d.v}
                          type="button"
                          onClick={() =>
                            setRecDays((cur) =>
                              cur.includes(d.v)
                                ? cur.filter((x) => x !== d.v)
                                : [...cur, d.v].sort((a, b) => a - b),
                            )
                          }
                          className={`w-9 h-9 rounded-full text-sm font-semibold transition ${
                            active
                              ? 'bg-brand text-white'
                              : 'bg-bg2 text-mute hover:bg-line'
                          }`}
                          aria-pressed={active}
                          title={[t('daySun'),t('dayMon'),t('dayTue'),t('dayWed'),t('dayThu'),t('dayFri'),t('daySat')][d.v]}
                        >
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="label">{t('time24h')}</label>
                  <input
                    type="time"
                    className="input"
                    value={recTime}
                    onChange={(e) => setRecTime(e.target.value)}
                  />
                </div>
                <p className="text-[11px] text-mute leading-relaxed">
                  {t('recurringHint')}
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 text-[11px] leading-relaxed rounded-lg border border-amber-300 bg-amber-50 text-amber-800 px-3 py-2">
            ⚠️ {t('broadcastWarnPrefix')} <b>{t('broadcastWarnAll')}</b>{' '}
            {form.cardId ? t('broadcastWarnSelectedCard') : t('broadcastWarnAllCards')}.{' '}
            {t('broadcastWarnNotIndividual')} <b>{t('broadcastWarnOnlyBirthday')}</b>,{' '}
            {t('broadcastWarnUseAn')}{' '}
            <Link href="/app/automations" className="underline font-semibold">
              {t('broadcastWarnAutomation')}
            </Link>
            .
          </div>

          {editingScheduledId && (
            <div className="mt-3 text-[11px] leading-relaxed rounded-lg border border-brand/40 bg-brand/5 text-ink px-3 py-2">
              {t('editingScheduledNotice')}
            </div>
          )}

          <button
            className="btn-primary mt-3 w-full justify-center"
            disabled={sending}
          >
            <Icon name="send" />{' '}
            {sending
              ? t('sending')
              : editingScheduledId
              ? t('saveChanges')
              : scheduleMode === 'recurring'
              ? t('createRecurrence')
              : scheduleMode === 'once'
              ? t('schedule')
              : t('send')}
          </button>
          {editingScheduledId && (
            <button
              type="button"
              className="btn-ghost mt-2 w-full justify-center text-xs"
              onClick={cancelEditScheduled}
            >
              {t('cancelEdit')}
            </button>
          )}
        </form>

        {/* Live preview iPhone */}
        <div className="self-start">
          <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold mb-2.5 text-center">
            {t('iphonePreview')}
          </div>
          <PushPreview
            brandName={brandName}
            title={form.title}
            body={form.body}
            scheduledAt={scheduleEnabled ? scheduledAt : null}
            brandColor={brandColor ?? undefined}
            brandLogoUrl={brandLogoUrl}
          />
        </div>

        {/* Plantillas */}
        <div className="card card-pad">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-base font-semibold m-0">{t('templates')}</h2>
            <span className="text-[11px] text-mute">
              {t('clickLoadsComposer')}
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
              {t('geopushTab')}
            </button>
            <button
              type="button"
              onClick={() => setActiveGroup('automations' as any)}
              className={`px-3 py-1.5 rounded-pill text-xs font-semibold transition ${
                (activeGroup as any) === 'automations'
                  ? 'bg-brand text-white shadow-sm'
                  : 'bg-bg2 text-ink hover:bg-line'
              }`}
            >
              {t('automationsTab')}
            </button>
          </div>

          {(activeGroup as any) === 'geopush' ? (
            <div>
              <p className="text-sm text-mute leading-relaxed">
                {t('geopushDesc1Prefix')}<b className="text-ink">{t('geopushTerm')}</b>{t('geopushDesc1Suffix')}
              </p>
              <p className="text-sm text-mute mt-2 leading-relaxed">
                {t('geopushDesc2')}
              </p>
              <Link
                href="/app/locations"
                className="btn-primary mt-4 inline-flex"
              >
                <Icon name="pin" /> {t('goToLocations')}
              </Link>
            </div>
          ) : (activeGroup as any) === 'automations' ? (
            <AutomationsTab />
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

      {/* Recurrencias activas (PUSH recurrentes #1 spec 2026-06-12).
          Lista cards con días + hora + status + toggle/delete. */}
      <div className="mt-5 card card-pad">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold m-0">{t('scheduledRecurrences')}</h2>
          <span className="text-xs text-mute">
            {recurring.length === 1
              ? t('recurrencesCountOne', { count: recurring.length })
              : t('recurrencesCountOther', { count: recurring.length })}
          </span>
        </div>
        {recurring.length === 0 ? (
          <p className="text-xs text-mute mt-2">
            {t('noRecurrencesYet')}
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {recurring.map((r: any) => {
              const dayLabels = [t('dayAbbrSun'), t('dayAbbrMon'), t('dayAbbrTue'), t('dayAbbrWed'), t('dayAbbrThu'), t('dayAbbrFri'), t('dayAbbrSat')];
              const days = (r.daysOfWeek as number[]).slice().sort((a, b) => a - b).map((d) => dayLabels[d]).join(', ');
              return (
                <div
                  key={r.id}
                  className={`flex items-start justify-between gap-3 p-3 rounded-lg border ${
                    r.isActive ? 'border-line bg-white' : 'border-line2 bg-bg2/40'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm truncate">{r.title}</span>
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                          r.isActive ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad-ink'
                        }`}
                      >
                        {r.isActive ? t('statusActive') : t('statusPaused')}
                      </span>
                    </div>
                    <div className="text-xs text-mute mt-1 line-clamp-2">{r.body}</div>
                    <div className="text-[11px] text-mute mt-1.5 flex flex-wrap gap-x-3">
                      <span>📅 {days}</span>
                      <span>🕐 {r.timeOfDay}</span>
                      {r.lastDispatchedAt && (
                        <span>
                          {t('lastDispatch')}{' '}
                          {new Date(r.lastDispatchedAt).toLocaleDateString('es-CO', {
                            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      onClick={() => toggleRecurring(r.id, !r.isActive)}
                    >
                      {r.isActive ? t('pause') : t('reactivate')}
                    </button>
                    <button
                      type="button"
                      className="text-xs text-bad hover:underline"
                      onClick={() => deleteRecurring(r.id)}
                    >
                      {t('delete')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Envíos programados (fecha única, aún no enviados) — editables/cancelables,
          igual que las recurrencias. Bug PDF: antes caían al historial sin poder
          modificarlos ni cancelarlos. */}
      <div className="mt-5 card card-pad">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold m-0">{t('scheduledSends')}</h2>
          <span className="text-xs text-mute">
            {scheduledPending.length === 1
              ? t('scheduledSendsCountOne', { count: scheduledPending.length })
              : t('scheduledSendsCountOther', { count: scheduledPending.length })}
          </span>
        </div>
        {scheduledPending.length === 0 ? (
          <p className="text-xs text-mute mt-2">{t('noScheduledSends')}</p>
        ) : (
          <div className="mt-3 space-y-2">
            {scheduledPending.map((n: any) => {
              const isEditing = editingScheduledId === n.id;
              return (
                <div
                  key={n.id}
                  className={`flex items-start justify-between gap-3 p-3 rounded-lg border ${
                    isEditing ? 'border-brand bg-brand/5' : 'border-line bg-white'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm truncate">{n.title}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-brand/10 text-brand">
                        {t('scheduledForLabel')}
                      </span>
                    </div>
                    <div className="text-xs text-mute mt-1 line-clamp-2">{n.body}</div>
                    <div className="text-[11px] text-mute mt-1.5">
                      🗓️{' '}
                      {new Date(n.scheduledAt).toLocaleString('es-CO', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      onClick={() => startEditScheduled(n)}
                    >
                      {t('editSend')}
                    </button>
                    <button
                      type="button"
                      className="text-xs text-bad hover:underline"
                      onClick={() => cancelScheduledSend(n.id)}
                    >
                      {t('cancelSend')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Historial colapsado */}
      <details className="mt-5 card card-pad">
        <summary className="cursor-pointer flex items-center justify-between">
          <span className="font-semibold text-sm">
            {t('sendHistory')}
          </span>
          <span className="text-xs text-mute">
            {realHistory.length === 1
              ? t('sendsCountOne', { count: realHistory.length })
              : t('sendsCountOther', { count: realHistory.length })}
          </span>
        </summary>
        <div className="mt-3 space-y-2">
          {realHistory.length === 0 ? (
            <div className="text-center py-6 text-sm text-mute">
              <div className="text-2xl mb-1">🔔</div>
              {t('noSendsYet')}
            </div>
          ) : (
            realHistory.map((n) => (
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
                  <div className="text-[10px]">{t('delivered')}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </details>
    </div>
  );
}

// =============================================================
//             Logo dedicado para push (icon.png del pase)
// =============================================================

function PushLogoCard({
  pushLogoUrl,
  fallbackUrl,
  brandName,
  brandColor,
  saving,
  onChange,
}: {
  pushLogoUrl: string | null;
  fallbackUrl: string | null;
  brandName: string;
  brandColor: string | null;
  saving: boolean;
  onChange: (url: string | null) => void | Promise<void>;
}) {
  const t = useTranslations('app_notifications');
  const [open, setOpen] = useState(false);
  const effective = pushLogoUrl ?? fallbackUrl;
  const initial = (brandName?.[0] || 'C').toUpperCase();
  const usingFallback = !pushLogoUrl && !!fallbackUrl;
  const noLogo = !effective;

  return (
    <div className="card card-pad mb-5">
      <div className="flex items-start gap-4">
        <div
          className="w-14 h-14 rounded-[14px] shrink-0 flex items-center justify-center text-white text-xl font-bold overflow-hidden border border-line"
          style={{
            background:
              brandColor || 'linear-gradient(135deg, #6366F1, #A855F7)',
          }}
        >
          {effective ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={effective}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            initial
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold m-0">
              {t('pushLogoTitle')}
            </h2>
            {pushLogoUrl ? (
              <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-pill bg-ok/10 text-ok">
                {t('badgeCustom')}
              </span>
            ) : usingFallback ? (
              <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-pill bg-amber-100 text-amber-800">
                {t('badgeUsingBusinessLogo')}
              </span>
            ) : (
              <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-pill bg-bg2 text-mute">
                {t('badgeNoLogo')}
              </span>
            )}
          </div>
          <p className="text-xs text-mute mt-1.5 leading-relaxed">
            {t('pushLogoDescPrefix')} <b className="text-ink">{t('pushLogoDescNo')}</b> {t('pushLogoDescSuffix')}
          </p>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <button
              type="button"
              className="btn-primary"
              onClick={() => setOpen(true)}
            >
              <Icon name="edit" />{' '}
              {pushLogoUrl ? t('changeLogo') : t('uploadLogo')}
            </button>
            {pushLogoUrl && (
              <button
                type="button"
                className="btn-ghost text-danger"
                onClick={() => onChange(null)}
                disabled={saving}
              >
                {t('delete')}
              </button>
            )}
            {noLogo && (
              <span className="text-[11px] text-amber-700">
                {t('noLogoHint')}
              </span>
            )}
          </div>
        </div>
      </div>

      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-md w-full p-5 max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-base font-semibold m-0">
                  {t('modalTitle')}
                </h3>
                <p className="text-xs text-mute mt-1">
                  {t('modalFormatHint')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-mute hover:text-ink text-xl leading-none"
                aria-label={t('close')}
              >
                ×
              </button>
            </div>
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-900 leading-relaxed mb-3">
              💡 {t('modalTipPrefix')} <b>{t('modalTipSquare')}</b> {t('modalTipSuffix')}
            </div>
            <ImageUploader
              value={pushLogoUrl}
              onChange={async (url) => {
                await onChange(url);
              }}
              folder="push-logos"
              crop={false}
            />
            {saving && (
              <div className="text-[11px] text-mute mt-2 text-center">
                {t('saving')}
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-line">
              <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold mb-2 text-center">
                {t('preview')}
              </div>
              <div
                className="mx-auto rounded-[20px] p-3 shadow-xl border border-white/10"
                style={{
                  background:
                    'linear-gradient(160deg, #1f1f3a 0%, #2c2554 50%, #5b3b8e 100%)',
                  maxWidth: 280,
                }}
              >
                <div className="bg-white/15 backdrop-blur-xl rounded-[16px] p-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-8 h-8 rounded-[8px] shrink-0 flex items-center justify-center text-white text-sm font-bold overflow-hidden"
                      style={{
                        background:
                          brandColor || 'linear-gradient(135deg, #6366F1, #A855F7)',
                      }}
                    >
                      {effective ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={effective}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        initial
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] uppercase tracking-wider font-semibold text-white truncate">
                        {brandName}
                      </div>
                    </div>
                    <div className="text-[10px] text-white/70">{t('now')}</div>
                  </div>
                  <div className="mt-1.5 text-white">
                    <div className="text-[12px] font-semibold leading-snug">
                      {t('sampleNotifTitle')}
                    </div>
                    <div className="text-[11px] mt-0.5 leading-snug opacity-90">
                      {t('sampleNotifBody')}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================
//                    Live preview iPhone
// =============================================================

function PushPreview({
  brandName,
  title,
  body,
  scheduledAt,
  brandColor,
  brandLogoUrl,
}: {
  brandName: string;
  title: string;
  body: string;
  scheduledAt: string | null;
  brandColor?: string;
  brandLogoUrl?: string | null;
}) {
  const t = useTranslations('app_notifications');
  const when = scheduledAt
    ? formatRelative(new Date(scheduledAt))
    : t('now');
  const showTitle = title.trim() || t('previewTitlePlaceholder');
  const showBody =
    body.trim() ||
    t('previewBodyPlaceholder');
  const initial = (brandName?.[0] || 'C').toUpperCase();

  // Hora "ahora" simulada para que se vea real en lock screen.
  const now = new Date();
  const hh = now.getHours().toString().padStart(2, '0');
  const mm = now.getMinutes().toString().padStart(2, '0');
  const dateLabel = now.toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div
      className="mx-auto rounded-[44px] border-[10px] border-ink shadow-2xl relative overflow-hidden"
      style={{
        width: 250,
        height: 510,
        background:
          'linear-gradient(160deg, #1f1f3a 0%, #2c2554 35%, #5b3b8e 70%, #8a4d8a 100%)',
      }}
    >
      {/* Status bar tiempo + íconos */}
      <div className="absolute top-3 left-0 right-0 px-6 flex items-center justify-between text-white text-[10px] font-semibold z-20 pointer-events-none">
        <span>{hh}:{mm}</span>
        <span className="opacity-90 tracking-tighter">●●● 100%</span>
      </div>

      {/* Dynamic Island / notch */}
      <div className="absolute left-1/2 -translate-x-1/2 top-3 w-24 h-7 bg-ink rounded-full z-10" />

      {/* Hora gigante estilo iOS lock screen */}
      <div className="absolute left-0 right-0 text-center text-white pt-12 z-10">
        <div className="text-[11px] font-medium opacity-80 capitalize">
          {dateLabel}
        </div>
        <div
          className="text-[64px] font-extralight tracking-tight leading-none mt-1"
          style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui' }}
        >
          {hh}:{mm}
        </div>
      </div>

      {/* Notification card iOS style */}
      <div className="absolute left-0 right-0 bottom-0 p-3 pb-6">
        <div className="bg-white/15 backdrop-blur-xl rounded-[20px] p-3 shadow-xl border border-white/10">
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-[7px] shrink-0 flex items-center justify-center text-white text-xs font-bold overflow-hidden"
              style={{
                background: brandColor || 'linear-gradient(135deg, #6366F1, #A855F7)',
              }}
            >
              {brandLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={brandLogoUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                initial
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-white truncate">
                {brandName}
              </div>
            </div>
            <div className="text-[10px] text-white/70">{when}</div>
          </div>
          <div className="mt-1.5 text-white">
            <div className="text-[12px] font-semibold leading-snug line-clamp-2">
              {showTitle}
            </div>
            <div className="text-[11px] mt-0.5 leading-snug opacity-90 line-clamp-3">
              {showBody}
            </div>
          </div>
        </div>

        {/* Bottom hint */}
        <div className="text-center text-white/50 text-[9px] mt-2">
          {t('swipeToOpen')}
        </div>
      </div>
    </div>
  );
}

// =============================================================
//                          Helpers
// =============================================================

/** Formato YYYY-MM-DDTHH:MM en zona local — para input[type=datetime-local]. */
function localISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatRelative(d: Date): string {
  const ms = d.getTime() - Date.now();
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'ahora';
  if (m < 60) return `en ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `en ${h} h`;
  const days = Math.round(h / 24);
  if (days < 7) return `en ${days} d`;
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}

// ─── Tab inline de automatizaciones (consume /api/automations) ───
function AutomationsTab() {
  const t = useTranslations('app_notifications');
  const [rules, setRules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api<any[]>('/automations')
      .then((rs) => setRules(rs ?? []))
      .catch(() => setRules([]))
      .finally(() => setLoading(false));
  }, []);
  return (
    <div>
      <p className="text-sm text-mute leading-relaxed">
        {t('automationsDescPrefix')}<b className="text-ink">{t('automationsTerm')}</b>{t('automationsDescSuffix')}
      </p>
      <Link
        href="/app/automations"
        className="btn-primary mt-3 inline-flex"
      >
        <Icon name="spark" /> {t('goToAutomations')}
      </Link>

      {loading && (
        <div className="mt-4 text-xs text-mute">{t('loadingRules')}</div>
      )}

      {!loading && rules.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
            {t('activeRulesCount', {
              active: rules.filter((r) => r.isActive).length,
              total: rules.length,
            })}
          </div>
          <div className="space-y-1.5 max-h-72 overflow-auto">
            {rules.map((r) => (
              <Link
                key={r.id}
                href="/app/automations"
                className="flex items-center gap-3 p-2 rounded-lg border border-line2 hover:bg-bg2 transition"
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    r.isActive ? 'bg-ok' : 'bg-mute'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{r.name}</div>
                  <div className="text-[11px] text-mute">
                    {t('triggerLabel')} {r.trigger?.type ?? '—'} ·{' '}
                    {t('actionsCount', { count: r.actions?.length ?? 0 })} · {t('runsCount', { count: r.stats?.runs ?? 0 })}
                  </div>
                </div>
                {r.stats?.lastRunAt && (
                  <div className="text-[10px] text-mute whitespace-nowrap">
                    {new Date(r.stats.lastRunAt).toLocaleDateString('es-CO', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </div>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {!loading && rules.length === 0 && (
        <div className="mt-4 p-4 text-center bg-bg2/40 rounded-lg text-sm text-mute">
          {t('noRulesPrefix')}{' '}
          <b className="text-ink">{t('noRulesTemplates')}</b> {t('noRulesSuffix')}
        </div>
      )}
    </div>
  );
}

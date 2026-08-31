'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PhoneInput } from '@/components/PhoneInput';
import { useTenantCountry } from '@/lib/useTenantCountry';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { publicHostForTenant } from '@/lib/public-domain';
import { Icon } from '@/components/Icon';
import { InfoLinkSocialCard } from '@/components/InfoLinkSocialCard';
import type { SocialConfig } from '@/lib/info-link-social';
import { errorDeTelefono, telLegible } from '@/lib/tel-link';
import { ImageUploader } from '@/components/ImageUploader';
import {
  INFO_LINK_TEMPLATES,
  resolveTemplate,
  type InfoLinkTemplate,
} from '@/lib/info-link-templates';
import { SectionCoverEditor } from '@/components/menu/SectionCoverEditor';
import { SectionCoverPreview } from '@/components/menu/SectionCoverPreview';
import { uploadCoverImage } from '@/lib/menu/upload-cover-image';
import {
  backgroundCss,
  type InfoLinkBackground,
  type InfoLinkPopup,
  type PopupSchedule,
} from '@/lib/info-link-extras';
import type { SectionCoverConfig } from '@/lib/menu/section-cover-config';
import { SortableList, DragHandle } from '@/components/Sortable';
import { ButtonDesignPanel } from '@/components/info-link-button-design';
import {
  StyledButtonLink,
  hasButtonStyleV2,
  pickButtonStyle,
  type InfoLinkButtonStyle,
} from '@/components/info-link-button-style';
import {
  DEFAULT_LOGO_CONTAINER,
  LOGO_CONTAINER_PRESETS,
  getLogoContainerProps,
  getLogoImgStyle,
  type LogoContainerConfig,
  type LogoContainerPresetId,
} from '@/lib/info-link-logo-container';
import {
  DEFAULT_BANNER_CONFIG,
  BANNER_PRESETS,
  getBannerBackgroundStyle,
  getBannerOverlayBackground,
  type BannerConfig,
  type BannerPresetId,
  type BannerPosition,
} from '@/lib/info-link-banner';
import { FULL_LOOKS, type FullLookId } from '@/lib/info-link-full-looks';
import type { InfoLinkTextColors } from '@/components/info-link-shells';
import { autoTextColor, contrastRatio } from '@/lib/contrast';
import { infolinkCapabilities } from '@/lib/infolink-tier';
import {
  DEFAULT_POPUP_CONFIG,
  POPUP_TEMPLATES,
  popupMaxWidthPx,
  popupShadowCss,
  type PopupConfig,
  type PopupTemplateId,
} from '@/lib/info-link-popup';

/** Devuelve true si el botón está renderizado como cover, false si simple.
 *  Si renderAs no está, se deriva de !!cover (compat botones viejos). */
function isCoverMode(b: { renderAs?: 'simple' | 'cover'; cover?: any }) {
  if (b.renderAs) return b.renderAs === 'cover';
  return !!b.cover;
}

/** Asegura un _id estable por botón. Si falta, lo genera. */
function ensureButtonId<B extends { _id?: string }>(b: B): B & { _id: string } {
  if (b._id) return b as B & { _id: string };
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `b_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  return { ...(b as object), _id: id } as B & { _id: string };
}

type Section =
  | { type: 'heading'; text: string; level?: number }
  | { type: 'paragraph'; text: string }
  | { type: 'image'; url: string; caption?: string }
  | { type: 'gallery'; images: string[] }
  | { type: 'divider' }
  | { type: 'embed_menu' }
  | { type: 'embed_promotions' }
  | { type: 'embed_card' };

type Button = InfoLinkButtonStyle & {
  /** Id estable para drag&drop sortable. Se autogenera si falta. */
  _id?: string;
  label: string;
  type:
    | 'WHATSAPP'
    | 'INSTAGRAM'
    | 'MAPS'
    | 'MENU'
    | 'CARD'
    | 'PROMO'
    | 'EXTERNAL'
    | 'POPUP'
    | 'PHONE';
  url?: string;
  // Campos específicos por tipo
  // INSTAGRAM: handle del usuario sin '@', se construye https://instagram.com/<handle>
  igHandle?: string;
  // WHATSAPP: número + mensaje pre-rellenado, se construye wa.me link
  waPhone?: string;
  waMessage?: string;
  // PHONE: número con indicativo de país. El botón abre el marcador con
  // `tel:`, no navega a ninguna página.
  phoneNumber?: string;
  // MAPS: locationId opcional (legacy, 1 sola sede) — si null, usa la primera.
  locationId?: string | null;
  // MAPS multi-sede (2026-07-25): modo de qué sedes mostrar al hacer click.
  //   'default'  → 1 sola sede (la primera registrada, o locationId legacy)
  //   'all'      → todas las sedes activas del negocio
  //   'selected' → solo las sedes de locationIds
  // Si ausente, se deriva: locationId presente → 'default' con esa sede;
  // ausente → 'default' con la primera. Con >1 sede el público abre un
  // popup con la lista de direcciones → Google Maps de cada una.
  locationMode?: 'default' | 'all' | 'selected';
  locationIds?: string[];
  style?: 'primary' | 'secondary';
  // Estilo de fondo del botón cuando renderAs = 'simple'. Default 'solid'
  // para botones nuevos; en botones viejos se deriva de `style`
  // (primary→solid, secondary→outline) cuando ausente.
  bgStyle?: 'solid' | 'transparent' | 'outline';
  // Estilo visual del botón. 'simple' (pill clásico) o 'cover' (card
  // visual tipo portada de sección de menú). Si está ausente, se
  // deriva de `!!cover` para compat con botones viejos.
  renderAs?: 'simple' | 'cover';
  // Diseño visual cuando renderAs = 'cover'. Cuando renderAs = 'simple'
  // se ignora pero se preserva por si el dueño vuelve a 'cover'.
  cover?: SectionCoverConfig | null;
  // Subtítulo que aparece debajo del título en la portada visual.
  // Solo se usa cuando renderAs = 'cover'.
  tagline?: string | null;
  // Si false, no se renderiza en la página pública (sin borrarlo).
  // Default true.
  isActive?: boolean;
  // Cuando type='POPUP', al hacer click el botón abre un modal con este
  // contenido en lugar de navegar.
  popup?: PopupConfig | null;
  // Cuando type='MENU', a qué versión del menú apunta el botón
  // (actualizado 2026-06-08 con separación de rutas /m vs /d):
  //   'DELIVERY' → /d/<slug>    (carrito + WhatsApp; default histórico)
  //   'MESA'     → /m/<slug>    (informativo, sin carrito)
  //   'BOOK'     → /book/<slug> (flipbook visual)
  menuVariant?: 'DELIVERY' | 'MESA' | 'BOOK';
};

type InfoLink = {
  id: string;
  slug: string;
  /** URL "vanity" GLOBAL en la raíz del dominio. soyclubify.com/<rootSlug>.
   *  null = sin vanity, accesible solo por /i/<tenantSlug>/<linkSlug>. */
  rootSlug: string | null;
  title: string;
  subtitle: string | null;
  heroImageUrl: string | null;
  gallery: string[];
  sections: Section[];
  buttons: Button[];
  theme: {
    primaryColor?: string;
    template?: InfoLinkTemplate;
    logoContainer?: LogoContainerConfig | null;
    bannerConfig?: BannerConfig | null;
    /** Familia tipográfica aplicada al shell completo. Si null, usa el
     *  default del template. */
    fontFamily?: string | null;
    /** Fondo personalizable (SOLID/GRADIENT/IMAGE). Ausente = default del
     *  template. */
    background?: InfoLinkBackground | null;
    /** Colores de texto por elemento (título/descripción/botones/secundario).
     *  Aditivo — cada campo ausente usa el color por defecto del template. */
    text?: InfoLinkTextColors | null;
    /** Redes sociales que se pintan debajo de la descripción, y su color.
     *  Ausente = sin fila propia; la página pública cae a los datos del
     *  negocio (Instagram/WhatsApp/Maps de la ficha) como hasta ahora. */
    social?: SocialConfig | null;
  };
  isActive: boolean;
  views: number;
};

const BUTTON_TYPE_LABEL: Record<string, string> = {
  WHATSAPP: '💬 WhatsApp',
  INSTAGRAM: '📷 Instagram',
  MAPS: '📍 Cómo llegar',
  MENU: '🍽 Ver menú',
  PROMO: '🎁 Promociones',
  EXTERNAL: '🔗 Link externo',
  POPUP: '💬 Popup informativo',
  PHONE: '📞 Llamada telefónica',
};

export default function InfoLinkEditor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [link, setLink] = useState<InfoLink | null>(null);
  const [tenant, setTenant] = useState<any>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [locations, setLocations] = useState<Array<{ id: string; name: string; address?: string | null }>>([]);
  // Tarjetas de fidelización del tenant — pobladas async para el
  // selector wallet del PopupEditor (G3).
  const [cards, setCards] = useState<Array<{ id: string; name: string }>>([]);
  // Índice del botón al que se le está editando el cover en modal.
  // null = modal cerrado.
  const [coverEditingIdx, setCoverEditingIdx] = useState<number | null>(null);
  const t = useTranslations('app_info_links_id');
  const country = useTenantCountry();

  async function load() {
    const l = await api<InfoLink>(`/info-links/${id}`);
    // Garantiza _id por botón al primer load para drag&drop.
    setLink({ ...l, buttons: l.buttons.map(ensureButtonId) });
    setTenant(await api('/tenants/me'));
    setStats(await api(`/info-links/${id}/stats`).catch(() => null));
    setLocations(
      await api<Array<{ id: string; name: string; address?: string | null }>>('/locations').catch(() => []),
    );
    setCards(
      await api<Array<{ id: string; name: string }>>('/cards').catch(() => []),
    );
  }
  useEffect(() => {
    load();
  }, [id]);

  async function save() {
    if (!link) return;
    setBusy(true);
    try {
      await api(`/info-links/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: link.title,
          subtitle: link.subtitle,
          // rootSlug: enviamos siempre — string limpio o '' para
          // desasociar. El backend valida reserved + duplicados.
          rootSlug: link.rootSlug ?? '',
          heroImageUrl: link.heroImageUrl,
          gallery: link.gallery,
          sections: link.sections,
          buttons: link.buttons,
          theme: link.theme,
          isActive: link.isActive,
        }),
      });
      setSavedAt(new Date());
    } catch (e: any) {
      // Validación del rootSlug (reservado, duplicado, etc.) viene como
      // mensaje claro del backend — lo mostramos al user con alert
      // (la página usa toasts en otros lados pero aquí no tengo el hook).
      // Re-throw para que el botón quede en estado normal.
      const msg = e?.message || t('saveFailed');
      alert(msg);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(t('confirmDeleteLink'))) return;
    await api(`/info-links/${id}`, { method: 'DELETE' });
    router.push('/app/info-links');
  }

  function update<K extends keyof InfoLink>(k: K, v: InfoLink[K]) {
    if (!link) return;
    setLink({ ...link, [k]: v });
  }

  function addSection(type: Section['type']) {
    if (!link) return;
    const s: any = { type };
    if (type === 'heading') s.text = t('newHeading');
    if (type === 'paragraph') s.text = t('paragraphPlaceholderText');
    if (type === 'image') s.url = '';
    if (type === 'gallery') s.images = [];
    update('sections', [...link.sections, s]);
  }

  function updateSection(i: number, patch: any) {
    if (!link) return;
    const arr = [...link.sections];
    arr[i] = { ...arr[i], ...patch } as any;
    update('sections', arr);
  }

  function removeSection(i: number) {
    if (!link) return;
    const arr = [...link.sections];
    arr.splice(i, 1);
    update('sections', arr);
  }

  function moveSection(i: number, dir: -1 | 1) {
    if (!link) return;
    const arr = [...link.sections];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    update('sections', arr);
  }

  function addButton() {
    if (!link) return;
    // Tope de botones por nivel del InfoLink (FREE = 5). PRO/FULL = ilimitado.
    const caps = infolinkCapabilities(tenant?.businessType, tenant?.infolinkTier);
    if (caps.maxButtons != null && link.buttons.length >= caps.maxButtons) {
      alert(
        `Tu plan Gratis permite hasta ${caps.maxButtons} botones. ` +
          `Mejora a PRO para botones ilimitados.`,
      );
      return;
    }
    const fresh: Button = {
      label: t('newButton'),
      type: 'EXTERNAL',
      url: 'https://',
      style: 'primary',
      bgStyle: 'solid',
      renderAs: 'simple',
      isActive: true,
    };
    update('buttons', [...link.buttons, ensureButtonId(fresh)]);
  }

  function updateButton(i: number, patch: Partial<Button>) {
    if (!link) return;
    const arr = [...link.buttons];
    arr[i] = { ...arr[i], ...patch };
    update('buttons', arr);
  }

  function removeButton(i: number) {
    if (!link) return;
    if (!confirm(t('confirmDeleteButton'))) return;
    const arr = [...link.buttons];
    arr.splice(i, 1);
    update('buttons', arr);
  }

  function duplicateButton(i: number) {
    if (!link) return;
    const src = link.buttons[i];
    if (!src) return;
    const copy = ensureButtonId({
      ...src,
      _id: undefined,
      label: t('copyLabel', { label: src.label }),
    });
    const arr = [...link.buttons];
    arr.splice(i + 1, 0, copy);
    update('buttons', arr);
  }

  function reorderButtons(next: Button[]) {
    update('buttons', next);
  }

  /** "Aplicar estilo a todos": copia los campos de diseño v2 de un botón
   *  al resto (spec #2). Solo toca los campos de estilo — conserva label,
   *  type, url, orden, etc. de cada botón. */
  function applyStyleToAll(style: InfoLinkButtonStyle) {
    if (!link) return;
    const arr = link.buttons.map((b) => ({ ...b, ...style }));
    update('buttons', arr);
  }

  function setButtonRenderAs(i: number, mode: 'simple' | 'cover') {
    if (!link) return;
    const b = link.buttons[i];
    if (!b) return;
    // Al pasar a 'cover' por primera vez, abrimos el modal para que el
    // dueño suba imagen y elija template. Si ya tenía cover, no abrimos
    // — solo cambiamos el modo.
    updateButton(i, { renderAs: mode });
    if (mode === 'cover' && !b.cover) {
      setCoverEditingIdx(i);
    }
  }

  if (!link || !tenant) return <div className="text-mute">{t('loading')}</div>;

  // Dominio público del negocio: customDomain (propio) > marca > soyclubify.com.
  // El link CANÓNICO (/i/...) solo se fuerza al dominio propio cuando hay
  // customDomain; para marcas blancas SIN dominio propio conservamos el origin
  // del panel (comportamiento histórico, no regresiona el link canónico ni el
  // testeo local). El vanity (rootSlug) sí usa shareHost, igual que antes.
  const shareHost = publicHostForTenant(tenant);
  // Capacidades por nivel del InfoLink (freemium). FREE limita botones; PRO/FULL
  // ilimitado. Solo afecta a negocios INFOLINK+FREE — el resto no ve gating.
  const caps = infolinkCapabilities(tenant?.businessType, tenant?.infolinkTier);
  const atButtonCap = caps.maxButtons != null && link.buttons.length >= caps.maxButtons;
  // Cross-sell a "Sellea Completo": solo para negocios Solo-InfoLink y solo si la
  // marca tiene configurado un Payment Link con productKey=FULL (sino, dormido).
  const isInfolinkBiz = tenant?.businessType === 'INFOLINK';
  const completoUrl =
    tenant?.whiteLabel?.paymentLinks?.find((l: any) => l.productKey === 'FULL')?.url ?? null;
  const hasOwnDomain = !!tenant?.customDomain;
  const publicBase = hasOwnDomain
    ? `https://${shareHost}`
    : typeof window !== 'undefined'
      ? window.location.origin
      : 'https://soyclubify.com';
  const publicUrl = `${publicBase}/i/${tenant.slug}/${link.slug}`;
  // URL personalizada (vanity): dominio del negocio + rootSlug. Se prefiere
  // SOLO cuando el dueño la definió (link.rootSlug). Los links antiguos tienen
  // rootSlug=null → displayUrl === publicUrl (/i/...), así sus QR ya impresos
  // siguen apuntando a la ruta canónica (que además nunca deja de funcionar).
  const vanityDomain = shareHost;
  const displayUrl = link.rootSlug
    ? `https://${vanityDomain}/${link.rootSlug}`
    : publicUrl;
  const primary = link.theme?.primaryColor ?? tenant.primaryColor ?? '#22C55E';

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {link.title}{' '}
          <span className="page-crumb">
            / {t('viewsQrCrumb', { views: link.views, qr: stats?.qrScans ?? 0 })}
          </span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          <Link
            href={`/app/info-links`}
            className="btn-ghost"
          >
            {t('back')}
          </Link>
          <a
            href="/preview/info-links"
            target="_blank"
            rel="noreferrer"
            className="btn-ghost text-xs"
            title={t('view5StylesTitle')}
          >
            {t('view5Styles')}
          </a>
          <a
            href={displayUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost"
          >
            <Icon name="arrow-right" /> {t('viewPublic')}
          </a>
          <button className="btn-primary" onClick={save} disabled={busy}>
            <Icon name="check" /> {busy ? t('saving') : t('save')}
          </button>
        </div>
      </div>

      {savedAt && (
        <div className="rounded-lg bg-ok-soft text-ok-ink px-3 py-2 mb-4 text-sm">
          {t('savedAt', { time: savedAt.toLocaleTimeString('es-CO') })}
        </div>
      )}

      {isInfolinkBiz && completoUrl && (
        <a
          href={completoUrl}
          target="_blank"
          rel="noreferrer"
          className="no-underline"
          style={{
            display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18,
            background: 'linear-gradient(120deg,#1A1033,#2f1f52 70%,#43285c)',
            color: '#FFF6F0', borderRadius: 16, padding: '14px 18px',
          }}
        >
          <span style={{ fontSize: 24 }}>🚀</span>
          <span style={{ flex: 1 }}>
            <b style={{ fontSize: 15 }}>Haz crecer tu negocio con Sellea</b>
            <span style={{ display: 'block', fontSize: 12.5, color: 'rgba(255,246,240,.78)', marginTop: 2 }}>
              Suma fidelización, Wallet, promociones y más — con la misma cuenta, sin perder tu InfoLink.
            </span>
          </span>
          <span style={{ background: '#FF4D3D', color: '#fff', fontWeight: 800, fontSize: 13, padding: '9px 16px', borderRadius: 999, whiteSpace: 'nowrap', flex: 'none' }}>
            Conocer Sellea Completo →
          </span>
        </a>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-5">
        {/* Editor */}
        <div className="space-y-5">
          {/* Estilo */}
          <div className="card card-pad">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h3 className="font-semibold m-0">{t('pageStyle')}</h3>
              <a
                href="/preview/info-links"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-brand hover:underline"
              >
                {t('view5StylesArrow')}
              </a>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {INFO_LINK_TEMPLATES.map((opt) => {
                const active = resolveTemplate(link.theme) === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      update('theme', { ...link.theme, template: opt.id })
                    }
                    className={`text-left rounded-input border-2 p-2.5 transition ${
                      active
                        ? 'border-brand bg-brand-soft'
                        : 'border-line bg-white hover:border-brand/40'
                    }`}
                    title={opt.hint}
                  >
                    <div className="text-xl mb-1">{opt.emoji}</div>
                    <div className="font-semibold text-sm">{opt.name}</div>
                    <div className="text-[10px] text-mute mt-0.5 leading-snug">
                      {opt.hint}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Info general */}
          <div className="card card-pad">
            <h3 className="font-semibold m-0 mb-4">{t('generalInfo')}</h3>

            <div>
              <label className="label">{t('title')}</label>
              <input
                className="input"
                value={link.title}
                onChange={(e) => update('title', e.target.value)}
              />
            </div>
            <div className="mt-3">
              <label className="label">{t('subtitleLabel')}</label>
              <input
                className="input"
                value={link.subtitle ?? ''}
                onChange={(e) => update('subtitle', e.target.value)}
              />
            </div>

            {/* URL personalizada (vanity) — <dominio de la marca>/<slug>. */}
            <div className="mt-3">
              <label className="label">
                {t('customUrl')}{' '}
                <span className="text-mute font-normal">{t('optionalDash')}</span>
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-mute select-none whitespace-nowrap">
                  {shareHost}/
                </span>
                <input
                  className="input flex-1"
                  value={link.rootSlug ?? ''}
                  placeholder={t('myBrandPlaceholder')}
                  onChange={(e) => {
                    // Normalizamos: lowercase + solo letras/números/guiones.
                    // El backend valida la forma final + reserved + duplicados.
                    const v = e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, '');
                    update('rootSlug', v.length === 0 ? null : v);
                  }}
                  maxLength={40}
                />
              </div>
              <p className="text-[11px] text-mute mt-1 leading-snug">
                {t('customUrlHelpBefore')} <code>/i/{tenant.slug}/{link.slug}</code>.
                {' '}{t('customUrlHelpMiddle')} <code>{shareHost}/{link.rootSlug || t('yourSlug')}</code>.
              </p>
            </div>

            <div className="mt-3">
              <label className="label">{t('heroImage')}</label>
              <ImageUploader
                value={link.heroImageUrl}
                onChange={(url) => update('heroImageUrl', url)}
                folder="info-links"
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('primaryColor')}</label>
                <input
                  type="color"
                  className="input h-11 p-1"
                  value={primary}
                  onChange={(e) =>
                    update('theme', { ...link.theme, primaryColor: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="label">{t('status')}</label>
                <select
                  className="input"
                  value={link.isActive ? '1' : '0'}
                  onChange={(e) => update('isActive', e.target.value === '1')}
                >
                  <option value="1">{t('statusActive')}</option>
                  <option value="0">{t('statusPaused')}</option>
                </select>
              </div>
            </div>
          </div>

          {/* Personalización visual — looks completos + paneles fine */}
          <VisualSection
            theme={link.theme}
            primary={primary}
            tenantLogoUrl={tenant?.logoUrl ?? null}
            heroImageUrl={link.heroImageUrl}
            lockPro={!caps.customBackground}
            onChange={(patch) => update('theme', { ...link.theme, ...patch })}
          />

          <InfoLinkSocialCard
            value={link.theme?.social ?? null}
            primary={primary}
            onChange={(social) => update('theme', { ...link.theme, social })}
          />

          {/* URL — muestra la personalizada (vanity) cuando existe; si no, /i/... */}
          <div className="card card-pad">
            <h3 className="font-semibold m-0 mb-3">{t('publicUrl')}</h3>
            <div className="flex items-center gap-2 bg-bg2 rounded-lg p-3">
              <code className="text-xs flex-1 break-all select-all">{displayUrl}</code>
              <button
                className="btn-link text-xs"
                onClick={() => navigator.clipboard.writeText(displayUrl)}
              >
                {t('copy')}
              </button>
              <a
                href={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(displayUrl)}&download=1`}
                download={`qr-${link.slug}.png`}
                className="btn-link text-xs"
              >
                {t('downloadQr')}
              </a>
            </div>
            {link.rootSlug && (
              // La ruta canónica /i/... nunca deja de funcionar (los QR antiguos
              // la usan). Se muestra como referencia, no como link principal.
              <p className="text-[11px] text-mute mt-2 leading-snug break-all">
                {t('customUrlCanonicalNote')} <code className="select-all">{publicUrl}</code>
              </p>
            )}
          </div>

          {/* Bloques */}
          <div className="card card-pad">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold m-0">{t('blocks')}</h3>
              <select
                className="input w-auto text-sm"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    addSection(e.target.value as Section['type']);
                    e.target.value = '';
                  }
                }}
              >
                <option value="">{t('addBlock')}</option>
                <option value="heading">{t('blockHeading')}</option>
                <option value="paragraph">{t('blockParagraph')}</option>
                <option value="image">{t('blockImage')}</option>
                <option value="gallery">{t('blockGallery')}</option>
                <option value="divider">{t('blockDivider')}</option>
                <option value="embed_menu">{t('blockEmbedMenu')}</option>
                <option value="embed_promotions">{t('blockEmbedPromotions')}</option>
                <option value="embed_card">{t('blockEmbedCard')}</option>
              </select>
            </div>

            <div className="space-y-2">
              {link.sections.length === 0 && (
                <div className="text-mute text-sm text-center py-4">
                  {t('noBlocks')}
                </div>
              )}
              {link.sections.map((s, i) => (
                <SectionEditor
                  key={i}
                  section={s}
                  onChange={(patch) => updateSection(i, patch)}
                  onMoveUp={() => moveSection(i, -1)}
                  onMoveDown={() => moveSection(i, 1)}
                  onRemove={() => removeSection(i)}
                  isFirst={i === 0}
                  isLast={i === link.sections.length - 1}
                />
              ))}
            </div>
          </div>

          {/* Botones */}
          <div className="card card-pad">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold m-0">
                {t('buttons')}
                {caps.maxButtons != null && (
                  <span className="text-xs font-normal text-mute ml-2">
                    {link.buttons.length}/{caps.maxButtons} · plan Gratis
                  </span>
                )}
              </h3>
              <button
                className={`btn-ghost text-sm ${atButtonCap ? 'opacity-60' : ''}`}
                onClick={addButton}
                title={atButtonCap ? 'Límite del plan Gratis — mejora a PRO' : undefined}
              >
                <Icon name="plus" /> {t('button')}
              </button>
            </div>

            {link.buttons.length === 0 && (
              <div className="text-mute text-sm text-center py-4">
                {t('noButtons')}
              </div>
            )}
            <SortableList<Button & { id: string }>
              items={link.buttons.map((b) => ({ ...ensureButtonId(b), id: b._id! }))}
              onReorder={(next) => reorderButtons(next.map(({ id, ...rest }) => rest))}
              className="space-y-2"
            >
              {(item, ctx) => {
                const i = link.buttons.findIndex((b) => b._id === item._id);
                if (i < 0) return null;
                const b = link.buttons[i];
                const coverMode = isCoverMode(b);
                const active = b.isActive !== false;
                return (
                <div
                  className={`border border-line2 rounded-lg p-3 grid grid-cols-1 sm:grid-cols-[auto_1fr_140px_auto] gap-2 transition ${
                    active ? '' : 'opacity-50 bg-bg2/30'
                  }`}
                >
                  {/* Barra superior: drag handle + segmented Simple/Visual
                      + active toggle + duplicar. Estilo segmented inspirado
                      en el editor de secciones del menú. */}
                  <div className="col-span-full flex items-center gap-2 flex-wrap">
                    <DragHandle {...ctx.dragHandleProps} />
                    <div className="inline-flex rounded-pill bg-bg2 p-0.5 text-[11px] font-semibold">
                      <button
                        type="button"
                        onClick={() => setButtonRenderAs(i, 'simple')}
                        className={`px-3 py-1.5 rounded-pill transition ${
                          coverMode
                            ? 'text-mute hover:text-ink'
                            : 'bg-white text-ink shadow-sm'
                        }`}
                      >
                        {t('simpleButton')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setButtonRenderAs(i, 'cover')}
                        className={`px-3 py-1.5 rounded-pill transition ${
                          coverMode
                            ? 'bg-white text-ink shadow-sm'
                            : 'text-mute hover:text-ink'
                        }`}
                      >
                        {t('visualCover')}
                      </button>
                    </div>
                    <div className="flex-1" />
                    <label className="flex items-center gap-1.5 text-[11px] text-mute cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={(e) =>
                          updateButton(i, { isActive: e.target.checked })
                        }
                      />
                      {active ? t('active') : t('paused')}
                    </label>
                    <button
                      type="button"
                      className="btn-ghost text-xs"
                      onClick={() => duplicateButton(i)}
                      title={t('duplicateButtonTitle')}
                    >
                      {t('duplicate')}
                    </button>
                  </div>

                  {/* Reservamos la primera celda de la grid principal con
                      un spacer para que el drag handle ya colocado en la
                      barra superior no se duplique. */}
                  <div className="hidden sm:block" />
                  <input
                    className="input"
                    placeholder={t('buttonTextPlaceholder')}
                    value={b.label}
                    onChange={(e) => updateButton(i, { label: e.target.value })}
                  />
                  <select
                    className="input"
                    value={b.type}
                    onChange={(e) =>
                      updateButton(i, { type: e.target.value as any })
                    }
                  >
                    {Object.entries(BUTTON_TYPE_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn-danger px-3"
                    onClick={() => removeButton(i)}
                  >
                    <Icon name="trash" />
                  </button>

                  {/* Cuando renderAs = 'cover': fila con preview + CTA edit
                      + input rápido de subtítulo. Si no tiene cover guardado
                      aún, mostramos CTA para abrir el editor (se autoabre
                      al cambiar a 'Visual'). */}
                  {coverMode && (
                    <div className="col-span-full border-t border-line2 pt-3 space-y-2">
                      <div className="flex items-center gap-3">
                        {b.cover ? (
                          <button
                            type="button"
                            className="flex-shrink-0 rounded-lg overflow-hidden border border-line hover:border-brand transition w-28"
                            onClick={() => setCoverEditingIdx(i)}
                            title={t('editCoverDesignTitle')}
                          >
                            <SectionCoverPreview
                              config={b.cover}
                              title={b.label || ''}
                              tagline={b.tagline || null}
                              scale={112 / 360}
                            />
                          </button>
                        ) : (
                          <div className="w-28 h-20 rounded-lg border-2 border-dashed border-line flex items-center justify-center text-mute text-xs">
                            {t('noCover')}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <input
                            className="input text-sm"
                            placeholder={t('taglinePlaceholder')}
                            value={b.tagline ?? ''}
                            onChange={(e) =>
                              updateButton(i, {
                                tagline: e.target.value || null,
                              })
                            }
                            maxLength={200}
                          />
                          <div className="text-[11px] text-mute mt-1">
                            {t('taglineHint')}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          onClick={() => setCoverEditingIdx(i)}
                        >
                          {t('designCover')}
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Picker de estilo del botón (solid/transparent/outline).
                      Solo aplica cuando renderAs = 'simple'. En cover, el
                      estilo lo decide el editor de portada. */}
                  {!coverMode && (
                    <div className="col-span-full flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] uppercase tracking-wider text-mute font-semibold">
                        {t('style')}
                      </span>
                      <div className="inline-flex rounded-pill bg-bg2 p-0.5 text-[11px] font-semibold">
                        {(['solid', 'transparent', 'outline'] as const).map((opt) => {
                          const current = (b.bgStyle ?? 'solid') === opt;
                          const label =
                            opt === 'solid'
                              ? t('bgStyleSolid')
                              : opt === 'transparent'
                              ? t('bgStyleTransparent')
                              : t('bgStyleOutline');
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => updateButton(i, { bgStyle: opt })}
                              className={`px-2.5 py-1 rounded-pill transition ${
                                current
                                  ? 'bg-white text-ink shadow-sm'
                                  : 'text-mute hover:text-ink'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* Diseño v2 por botón: forma, colores, efectos, icono y
                      alineación. Aditivo — solo aplica cuando el usuario
                      configura algo (hasButtonStyleV2). En cover el estilo lo
                      decide el editor de portada. */}
                  {!coverMode && (
                    <ButtonDesignPanel
                      b={b}
                      primary={primary}
                      onPatch={(patch) => updateButton(i, patch)}
                      onApplyAll={applyStyleToAll}
                    />
                  )}
                  {b.type === 'EXTERNAL' && (
                    <input
                      className="input col-span-full"
                      placeholder="https://..."
                      value={b.url ?? ''}
                      onChange={(e) => updateButton(i, { url: e.target.value })}
                    />
                  )}
                  {b.type === 'MENU' && (
                    <div className="col-span-full">
                      <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-1.5">
                        {t('whichMenuVersion')}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {(
                          [
                            {
                              v: 'DELIVERY',
                              label: t('menuDeliveryLabel'),
                              hint: t('menuDeliveryHint'),
                            },
                            {
                              v: 'MESA',
                              label: t('menuMesaLabel'),
                              hint: t('menuMesaHint'),
                            },
                            {
                              v: 'BOOK',
                              label: t('menuBookLabel'),
                              hint: t('menuBookHint'),
                            },
                          ] as const
                        ).map((opt) => {
                          const active = (b.menuVariant ?? 'DELIVERY') === opt.v;
                          return (
                            <button
                              type="button"
                              key={opt.v}
                              onClick={() =>
                                updateButton(i, { menuVariant: opt.v })
                              }
                              className={`text-left rounded-input border-2 p-2.5 transition ${
                                active
                                  ? 'border-brand bg-brand-soft'
                                  : 'border-line bg-white hover:border-brand/40'
                              }`}
                            >
                              <div className="text-sm font-semibold">
                                {opt.label}
                              </div>
                              <div className="text-[10px] text-mute mt-0.5 leading-snug">
                                {opt.hint}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      <div className="text-[11px] text-mute mt-1.5">
                        {t('menuStorefrontWarnBefore')}{' '}
                        <a href="/app/storefront" className="text-brand hover:underline">
                          /app/storefront
                        </a>
                        {t('menuStorefrontWarnAfter')}
                      </div>
                    </div>
                  )}
                  {b.type === 'PHONE' && (
                    <div className="col-span-full">
                      <input
                        className="input"
                        placeholder="+57 300 123 4567"
                        inputMode="tel"
                        value={b.phoneNumber ?? ''}
                        onChange={(e) =>
                          updateButton(i, { phoneNumber: e.target.value })
                        }
                      />
                      {/* El aviso va aquí y no al guardar: sin número válido
                          el botón no se pinta en la página pública, y el
                          negocio se queda creyendo que lo tiene puesto. */}
                      {errorDeTelefono(b.phoneNumber) ? (
                        <div className="text-[11px] text-danger mt-1">
                          {errorDeTelefono(b.phoneNumber)}
                        </div>
                      ) : (
                        <div className="text-[11px] text-mute mt-1">
                          Al tocarlo se abre el marcador con{' '}
                          <b>{telLegible(b.phoneNumber)}</b>
                        </div>
                      )}
                    </div>
                  )}
                  {b.type === 'INSTAGRAM' && (
                    <div className="col-span-full">
                      <div className="flex gap-2 items-center">
                        <span className="text-mute text-sm font-semibold">@</span>
                        <input
                          className="input flex-1"
                          placeholder="nudocowork"
                          value={b.igHandle ?? ''}
                          onChange={(e) =>
                            updateButton(i, {
                              igHandle: e.target.value
                                .replace(/^@/, '')
                                .trim(),
                            })
                          }
                        />
                      </div>
                      <div className="text-[11px] text-mute mt-1">
                        {t('igHelp')} instagram.com/<b>{b.igHandle || t('igUserFallback')}</b>
                      </div>
                    </div>
                  )}
                  {b.type === 'WHATSAPP' && (
                    // Cada campo en su propia fila y a ancho completo. Antes el
                    // teléfono iba en una columna de 160px, pero el botón de
                    // bandera+prefijo del PhoneInput ocupa 120px → al número le
                    // quedaban ~34px (inusable) y la gente escribía el número en
                    // el campo de mensaje. Resultado: waPhone="+58" sin número y
                    // el botón de WhatsApp no funcionaba.
                    <div className="col-span-full space-y-2">
                      <div>
                        <div className="text-[11px] font-semibold text-mute mb-1">
                          {t('waNumberLabel')}
                        </div>
                        <PhoneInput
                          value={b.waPhone ?? ''}
                          onChange={(v) => updateButton(i, { waPhone: v })}
                          defaultCountry={country}
                        />
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold text-mute mb-1">
                          {t('waMessageLabel')}
                        </div>
                        <input
                          className="input w-full"
                          placeholder={t('waMessagePlaceholder')}
                          value={b.waMessage ?? ''}
                          onChange={(e) => updateButton(i, { waMessage: e.target.value })}
                        />
                      </div>
                    </div>
                  )}
                  {b.type === 'MAPS' && (
                    <div className="col-span-full">
                      {locations.length === 0 ? (
                        <div className="text-[11px] text-mute p-2 bg-bg2/50 rounded">
                          {t('noLocations')}{' '}
                          <a href="/app/locations" className="text-brand underline">
                            {t('createLocation')}
                          </a>
                        </div>
                      ) : (
                        (() => {
                          const mode = b.locationMode ?? 'default';
                          const selectedIds = b.locationIds ?? [];
                          return (
                            <>
                              {/* Modo: 1 sede por default / todas / elegir cuáles */}
                              <div className="grid grid-cols-3 gap-1 bg-bg2 rounded-lg p-1">
                                {([
                                  { v: 'default' as const, label: t('locModeDefault') },
                                  { v: 'all' as const, label: t('locModeAll') },
                                  { v: 'selected' as const, label: t('locModeSelected') },
                                ]).map((opt) => {
                                  const active = mode === opt.v;
                                  return (
                                    <button
                                      key={opt.v}
                                      type="button"
                                      onClick={() =>
                                        updateButton(i, { locationMode: opt.v })
                                      }
                                      className={`text-[11px] font-semibold py-1.5 px-1 rounded-md transition ${
                                        active
                                          ? 'bg-white text-ink shadow-sm'
                                          : 'text-mute hover:text-ink'
                                      }`}
                                    >
                                      {opt.label}
                                    </button>
                                  );
                                })}
                              </div>

                              {mode === 'default' && (
                                <div className="mt-2">
                                  <select
                                    className="input"
                                    value={b.locationId ?? ''}
                                    onChange={(e) =>
                                      updateButton(i, {
                                        locationId: e.target.value || null,
                                      })
                                    }
                                  >
                                    <option value="">
                                      {t('firstLocationDefault')}
                                    </option>
                                    {locations.map((loc) => (
                                      <option key={loc.id} value={loc.id}>
                                        {loc.name}
                                        {loc.address ? ` · ${loc.address}` : ''}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}

                              {mode === 'selected' && (
                                <div className="mt-2 space-y-1.5 border border-line2 rounded-lg p-2 max-h-48 overflow-y-auto">
                                  {locations.map((loc) => {
                                    const checked = selectedIds.includes(loc.id);
                                    return (
                                      <label
                                        key={loc.id}
                                        className="flex items-start gap-2 text-[12px] cursor-pointer"
                                      >
                                        <input
                                          type="checkbox"
                                          className="mt-0.5"
                                          checked={checked}
                                          onChange={() =>
                                            updateButton(i, {
                                              locationIds: checked
                                                ? selectedIds.filter(
                                                    (id) => id !== loc.id,
                                                  )
                                                : [...selectedIds, loc.id],
                                            })
                                          }
                                        />
                                        <span>
                                          <span className="font-medium">
                                            {loc.name}
                                          </span>
                                          {loc.address ? (
                                            <span className="text-mute">
                                              {' '}· {loc.address}
                                            </span>
                                          ) : null}
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                              )}

                              <p className="text-[11px] text-mute mt-1.5">
                                {mode === 'default'
                                  ? t('locHintDefault')
                                  : t('locHintMulti')}
                              </p>
                            </>
                          );
                        })()
                      )}
                    </div>
                  )}
                  {b.type === 'POPUP' && (
                    <div className="col-span-full border-t border-line2 pt-3">
                      <PopupEditor
                        value={b.popup ?? null}
                        primary={primary}
                        onChange={(next) => updateButton(i, { popup: next })}
                        cards={cards}
                      />
                    </div>
                  )}
                  {/* Popup PRE-ACCIÓN (G2): cualquier botón que NO sea
                      type='POPUP' puede mostrar un popup ANTES de abrir
                      su link. Toggle on/off + cuando está on, mismo
                      PopupEditor reusado. UX típica: "Antes de reservar,
                      instala nuestra tarjeta y recibe beneficios". */}
                  {b.type !== 'POPUP' && (
                    <div className="col-span-full border-t border-line2 pt-3">
                      <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!!b.popup}
                          onChange={(e) =>
                            updateButton(i, {
                              popup: e.target.checked
                                ? DEFAULT_POPUP_CONFIG
                                : null,
                            })
                          }
                          className="accent-brand"
                        />
                        {t('showPopupBeforeOpen')}
                      </label>
                      <p className="text-[11px] text-mute mt-1 leading-relaxed">
                        {t('showPopupBeforeOpenHelp')}
                      </p>
                      {b.popup && (
                        <div className="mt-3">
                          <PopupEditor
                            value={b.popup}
                            primary={primary}
                            onChange={(next) =>
                              updateButton(i, { popup: next })
                            }
                            cards={cards}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
                );
              }}
            </SortableList>
          </div>

          {/* Stats */}
          {stats && (
            <div className="card card-pad">
              <h3 className="font-semibold m-0 mb-3">{t('stats30Days')}</h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="text-xs text-mute uppercase tracking-wider">
                    {t('statsViews')}
                  </div>
                  <div className="text-2xl font-bold">{stats.views}</div>
                </div>
                <div>
                  <div className="text-xs text-mute uppercase tracking-wider">
                    {t('statsQrScans')}
                  </div>
                  <div className="text-2xl font-bold">{stats.qrScans}</div>
                </div>
                <div>
                  <div className="text-xs text-mute uppercase tracking-wider">
                    {t('statsButtonClicks')}
                  </div>
                  <div className="text-2xl font-bold">
                    {Object.values(stats.buttonClicks ?? {}).reduce(
                      (s: number, n: any) => s + Number(n),
                      0,
                    )}
                  </div>
                </div>
              </div>
              {Object.keys(stats.buttonClicks ?? {}).length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {Object.entries(stats.buttonClicks).map(([label, n]) => (
                    <div
                      key={label}
                      className="flex justify-between text-sm border-b border-line2 py-1.5"
                    >
                      <span>{label}</span>
                      <strong>{n as number}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <button onClick={remove} className="text-bad underline text-sm">
            {t('deleteLink')}
          </button>
        </div>

        {/* Preview iPhone */}
        <div className="lg:sticky lg:top-6 self-start">
          <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold mb-2.5">
            {t('preview')}
          </div>
          <div className="flex justify-center">
            <div className="iphone">
              <div className="iphone-notch" />
              <div
                className="iphone-screen overflow-auto"
                style={{ minHeight: 540, maxHeight: 700 }}
              >
                <div className="iphone-bar">
                  <span>11:42</span>
                  <span className="text-[10px]">●●● 100%</span>
                </div>
                <PublicLinkPreview link={link} tenant={tenant} primary={primary} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal editor de cover por botón. Reutiliza SectionCoverEditor
          (el mismo del layout SECTIONS del menú) — así los botones se
          configuran con la misma UX que las secciones de menú. */}
      {coverEditingIdx !== null && link.buttons[coverEditingIdx] && (
        <CoverModal
          button={link.buttons[coverEditingIdx]}
          onClose={() => setCoverEditingIdx(null)}
          onPatch={(patch) => updateButton(coverEditingIdx, patch)}
        />
      )}
    </div>
  );
}

function CoverModal({
  button,
  onClose,
  onPatch,
}: {
  button: Button;
  onClose: () => void;
  onPatch: (patch: Partial<Button>) => void;
}) {
  const t = useTranslations('app_info_links_id');
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg w-full max-w-5xl rounded-none sm:rounded-2xl shadow-xl my-0 sm:my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-bg z-10 flex items-center justify-between px-5 py-3 border-b border-line">
          <div>
            <div className="text-xs text-mute">{t('buttonCover')}</div>
            <h2 className="font-semibold text-lg m-0">
              {button.label || t('untitled')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-mute hover:text-ink p-1"
            aria-label={t('close')}
          >
            ✕
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="label">{t('taglineLabelOptional')}</label>
            <input
              type="text"
              className="input"
              placeholder={t('taglineExample')}
              value={button.tagline ?? ''}
              onChange={(e) => onPatch({ tagline: e.target.value || null })}
              maxLength={200}
            />
            <p className="text-[11px] text-mute mt-1">
              {t('taglineModalHint')}
            </p>
          </div>

          <SectionCoverEditor
            title={button.label || ''}
            tagline={button.tagline || null}
            value={button.cover ?? null}
            onChange={(cover) => onPatch({ cover })}
            onUpload={uploadCoverImage}
          />
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line">
          <button
            type="button"
            onClick={() => onPatch({ cover: null })}
            className="btn-ghost text-xs"
            title={t('resetDesignTitle')}
          >
            {t('resetDesign')}
          </button>
          <button type="button" onClick={onClose} className="btn-primary">
            {t('done')}
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================
// Section editor inline
// =====================================================
function SectionEditor({
  section,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
  isFirst,
  isLast,
}: {
  section: Section;
  onChange: (patch: any) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const t = useTranslations('app_info_links_id');
  return (
    <div className="border border-line2 rounded-lg p-3 group">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-mute font-semibold">
          {section.type.replace('_', ' ')}
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
          <button
            disabled={isFirst}
            onClick={onMoveUp}
            className="text-mute hover:text-ink disabled:opacity-30 px-1"
          >
            ↑
          </button>
          <button
            disabled={isLast}
            onClick={onMoveDown}
            className="text-mute hover:text-ink disabled:opacity-30 px-1"
          >
            ↓
          </button>
          <button onClick={onRemove} className="text-bad px-1">
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>

      {section.type === 'heading' && (
        <input
          className="input"
          value={section.text}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder={t('title')}
        />
      )}
      {section.type === 'paragraph' && (
        <textarea
          className="input"
          value={section.text}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder={t('paragraphPlaceholder')}
        />
      )}
      {section.type === 'image' && (
        <ImageUploader
          value={section.url}
          onChange={(url) => onChange({ url })}
          folder="info-links"
        />
      )}
      {section.type === 'gallery' && (
        <div>
          <div className="grid grid-cols-3 gap-2 mb-2">
            {section.images.map((url, i) => (
              <div key={i} className="relative">
                <img
                  src={url}
                  alt=""
                  className="w-full h-20 object-cover rounded"
                />
                <button
                  className="absolute top-1 right-1 bg-bad text-white rounded-full w-5 h-5 text-xs"
                  onClick={() => {
                    const arr = [...section.images];
                    arr.splice(i, 1);
                    onChange({ images: arr });
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <ImageUploader
            value={null}
            onChange={(url) => {
              if (url) onChange({ images: [...section.images, url] });
            }}
            folder="info-links"
          />
        </div>
      )}
      {section.type === 'divider' && (
        <div className="border-t border-line my-2" />
      )}
      {(section.type === 'embed_menu' ||
        section.type === 'embed_promotions' ||
        section.type === 'embed_card') && (
        <div className="text-xs text-mute italic">
          {t('embedAutoRender')}
        </div>
      )}
    </div>
  );
}

// =====================================================
// Preview público (mismo render que /i/[slug]/[linkSlug])
// =====================================================
function PublicLinkPreview({
  link,
  tenant,
  primary,
}: {
  link: InfoLink;
  tenant: any;
  primary: string;
}) {
  const t = useTranslations('app_info_links_id');
  const initial = (tenant?.brandName?.[0] || 'C').toUpperCase();
  // Fondo custom + colores de texto (theme.text). Sin fondo custom, blanco.
  // Aplicamos el fondo real aquí para que la preview NO mienta cuando el
  // usuario elige texto claro (ej. "Auto contraste" sobre fondo oscuro).
  const customBg = backgroundCss(link.theme?.background ?? null);
  const tc: InfoLinkTextColors = link.theme?.text ?? {};
  return (
    <div
      className={`text-ink ${customBg ? '' : 'bg-white'}`}
      style={{
        ['--primary' as any]: primary,
        ...(customBg ? { background: customBg } : {}),
      }}
    >
      {/* Hero: contenedor SEPARADO del logo. overflow-hidden recorta solo
          la foto al frame del banner, no afecta al logo (siblings). */}
      <div className="relative overflow-hidden" style={{ zIndex: 1 }}>
        {link.heroImageUrl ? (
          <img
            src={link.heroImageUrl}
            alt=""
            className="w-full h-28 object-cover"
          />
        ) : (
          <div
            className="w-full h-24"
            style={{
              background: `linear-gradient(135deg, ${primary}, ${tenant?.secondaryColor || primary})`,
            }}
          />
        )}
      </div>
      {/* Logo wrapper: HERMANO del banner (no hijo), con margin negativo
          para flotar sobre el borde inferior del banner. z-index 10 lo
          mantiene encima de cualquier overlay del banner. */}
      <div
        className="flex justify-center -mt-7 relative"
        style={{ zIndex: 10 }}
      >
        {tenant?.logoUrl ? (
          <div className="w-14 h-14 rounded-full bg-white border-4 border-white shadow-md p-1 flex items-center justify-center overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={tenant.logoUrl}
              alt=""
              className="max-w-full max-h-full w-auto h-auto object-contain block"
            />
          </div>
        ) : (
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg border-4 border-white shadow-md"
            style={{ background: primary }}
          >
            {initial}
          </div>
        )}
      </div>

      <div className="px-4 pt-3 pb-4 text-center">
        <h1
          className="text-base font-bold leading-tight"
          style={tc.title ? { color: tc.title } : undefined}
        >
          {link.title}
        </h1>
        {link.subtitle && (
          <p
            className="text-[11px] text-mute mt-1 leading-snug"
            style={tc.description ? { color: tc.description } : undefined}
          >
            {link.subtitle}
          </p>
        )}

        {/* Botones tipo Linktree (o cards estilo "sección" si renderAs=cover).
            Los pausados (isActive === false) no aparecen en la preview, igual
            que en el público. */}
        {link.buttons.some((b) => b.isActive !== false) && (
          <div className="space-y-2 mt-4 text-left">
            {link.buttons
              .filter((b) => b.isActive !== false)
              .map((b, i) => {
                if (isCoverMode(b) && b.cover) {
                  return (
                    <div key={i} className="rounded-xl overflow-hidden">
                      <SectionCoverPreview
                        config={b.cover}
                        title={b.label || ''}
                        tagline={b.tagline || null}
                        scale={0.45}
                      />
                    </div>
                  );
                }
                if (hasButtonStyleV2(b)) {
                  return (
                    <StyledButtonLink
                      key={i}
                      b={{ ...pickButtonStyle(b), label: b.label }}
                      primary={primary}
                      asDiv
                    />
                  );
                }
                const bgStyle =
                  b.bgStyle ?? (b.style === 'secondary' ? 'outline' : 'solid');
                const style: CSSProperties = {};
                if (bgStyle === 'solid') {
                  style.background = primary;
                  style.color = '#fff';
                  style.boxShadow = `0 4px 12px ${primary}33`;
                } else if (bgStyle === 'outline') {
                  style.background = 'transparent';
                  style.color = primary;
                  style.border = `1.5px solid ${primary}`;
                } else {
                  // transparent
                  style.background = 'transparent';
                  style.color = primary;
                }
                // Override del color de texto del botón (theme.text.button).
                if (tc.button) style.color = tc.button;
                return (
                  <div
                    key={i}
                    className="block w-full py-2.5 px-4 rounded-2xl text-center text-[13px] font-semibold transition"
                    style={style}
                  >
                    {b.label}
                  </div>
                );
              })}
          </div>
        )}

        {/* Bloques */}
        <div className="mt-4 space-y-3 text-left">
          {link.sections.map((s, i) => {
            if (s.type === 'heading')
              return (
                <h2 key={i} className="font-bold text-base">
                  {s.text}
                </h2>
              );
            if (s.type === 'paragraph')
              return (
                <p key={i} className="text-xs text-ink/80 leading-relaxed">
                  {s.text}
                </p>
              );
            if (s.type === 'image' && s.url)
              return (
                <img key={i} src={s.url} alt="" className="w-full rounded-lg" />
              );
            if (s.type === 'gallery')
              return (
                <div key={i} className="grid grid-cols-3 gap-1">
                  {s.images.map((url, j) => (
                    <img
                      key={j}
                      src={url}
                      alt=""
                      className="w-full h-14 object-cover rounded"
                    />
                  ))}
                </div>
              );
            if (s.type === 'divider')
              return <div key={i} className="border-t border-line my-2" />;
            if (s.type === 'embed_menu')
              return (
                <div
                  key={i}
                  className="border border-line2 rounded-lg p-2 text-[10px] text-mute italic text-center"
                >
                  {t('previewEmbedMenu')}
                </div>
              );
            if (s.type === 'embed_promotions')
              return (
                <div
                  key={i}
                  className="border border-line2 rounded-lg p-2 text-[10px] text-mute italic text-center"
                >
                  {t('previewEmbedPromotions')}
                </div>
              );
            if (s.type === 'embed_card')
              return (
                <div
                  key={i}
                  className="border border-line2 rounded-lg p-2 text-[10px] text-mute italic text-center"
                >
                  {t('previewEmbedCard')}
                </div>
              );
            return null;
          })}
        </div>

        {/* Footer — marca del negocio (Sellea, etc.), no Clubify hardcodeado. */}
        <div className="mt-6 pt-4 border-t border-line text-center text-[10px] text-mute">
          {t('developedBy')}{' '}
          <span className="font-semibold text-brand">
            {tenant?.whiteLabelName || 'Clubify'}
          </span>
        </div>
      </div>
    </div>
  );
}

// =====================================================
/** Candado PRO: en plan FREE muestra el panel atenuado + overlay "Disponible
 *  con PRO". Solo se activa para negocios INFOLINK+FREE (freemium Sellea); el
 *  resto ve el panel normal. El upgrade real (Stripe) llega en 2D. */
function ProLock({ active, feature, children }: { active: boolean; feature: string; children: ReactNode }) {
  if (!active) return <>{children}</>;
  return (
    <div className="relative">
      <div className="pointer-events-none opacity-50 select-none" aria-hidden="true">
        {children}
      </div>
      <button
        type="button"
        onClick={() =>
          alert(`${feature} está disponible con PRO. Mejora tu plan para desbloquearlo.`)
        }
        className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-xl"
        style={{ background: 'rgba(255,251,247,.62)', backdropFilter: 'blur(1px)' }}
      >
        <span className="text-sm font-bold text-ink">🔒 Disponible con PRO</span>
        <span className="text-xs text-mute">Toca para mejorar tu plan</span>
      </button>
    </div>
  );
}

// VisualSection — wrapper que agrupa logo + banner + tipografía + looks
// =====================================================
//
// Una sola card en el editor que cubre toda la personalización visual:
// 1. Row de "Looks completos" arriba (4 presets que bundlean logo+banner+font)
// 2. Logo container panel (preset + sliders fine)
// 3. Banner panel (preset + sliders fine)
// 4. Tipografía global
//
// Reemplaza al stack de cards sueltas — UX más cercana a Notion/Stripe
// donde toda la personalización vive bajo un mismo techo.
function VisualSection({
  theme,
  primary,
  tenantLogoUrl,
  heroImageUrl,
  lockPro,
  onChange,
}: {
  theme: {
    template?: InfoLinkTemplate;
    logoContainer?: LogoContainerConfig | null;
    bannerConfig?: BannerConfig | null;
    fontFamily?: string | null;
    background?: InfoLinkBackground | null;
    text?: InfoLinkTextColors | null;
    popup?: InfoLinkPopup | null;
    popups?: InfoLinkPopup[] | null;
  };
  primary: string;
  tenantLogoUrl: string | null;
  heroImageUrl: string | null;
  /** Plan FREE: bloquea fondos/colores personalizados (candado "PRO"). */
  lockPro?: boolean;
  onChange: (patch: {
    logoContainer?: LogoContainerConfig | null;
    bannerConfig?: BannerConfig | null;
    fontFamily?: string | null;
    background?: InfoLinkBackground | null;
    text?: InfoLinkTextColors | null;
    popup?: InfoLinkPopup | null;
    popups?: InfoLinkPopup[] | null;
  }) => void;
}) {
  const t = useTranslations('app_info_links_id');
  function applyFullLook(id: FullLookId) {
    const look = FULL_LOOKS[id];
    onChange({
      logoContainer: { ...look.logoContainer },
      bannerConfig: { ...look.bannerConfig },
      fontFamily: look.fontFamily,
    });
  }
  function activeLookId(): FullLookId | null {
    return (theme.logoContainer?.preset ?? null) as FullLookId | null;
  }

  const FONT_OPTIONS: Array<{ value: string; label: string }> = [
    { value: 'Inter, system-ui, sans-serif', label: t('fontInter') },
    { value: '"Playfair Display", Georgia, serif', label: t('fontPlayfair') },
    { value: '"Space Grotesk", Inter, sans-serif', label: t('fontSpaceGrotesk') },
    { value: '"Manrope", Inter, sans-serif', label: t('fontManrope') },
    { value: 'Georgia, "Times New Roman", serif', label: t('fontGeorgia') },
    { value: '"Poppins", Inter, sans-serif', label: t('fontPoppins') },
  ];

  return (
    <div className="card card-pad space-y-6">
      <div>
        <h3 className="font-semibold m-0 mb-1">{t('visualCustomization')}</h3>
        <div className="text-xs text-mute leading-relaxed">
          {t('visualCustomizationHelp')}
        </div>
      </div>

      {/* FullLook presets — un click setea logo+banner+font juntos */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
          {t('fullLooks')}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {(Object.keys(FULL_LOOKS) as FullLookId[]).map((id) => {
            const look = FULL_LOOKS[id];
            const active = activeLookId() === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => applyFullLook(id)}
                className={`text-left rounded-lg p-3 border transition ${
                  active
                    ? 'border-brand bg-brand/5 shadow-sm'
                    : 'border-line hover:border-ink/30 hover:shadow-sm'
                }`}
              >
                <div className="font-semibold text-sm">{look.label}</div>
                <div
                  className="text-[11px] text-mute mt-0.5 leading-snug"
                  style={{ fontFamily: look.fontFamily }}
                >
                  {look.description}
                </div>
              </button>
            );
          })}
        </div>
        <div className="text-[11px] text-mute mt-2 leading-snug">
          {t('fullLooksTip')}
        </div>
      </div>

      {/* Tipografía */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
          {t('typography')}
        </div>
        <select
          className="input"
          value={theme.fontFamily ?? ''}
          onChange={(e) =>
            onChange({ fontFamily: e.target.value || null })
          }
        >
          <option value="">{t('templateDefault')}</option>
          {FONT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value} style={{ fontFamily: opt.value }}>
              {opt.label}
            </option>
          ))}
        </select>
        {theme.fontFamily && (
          <div
            className="mt-2 p-3 rounded-lg bg-bg2 text-ink"
            style={{ fontFamily: theme.fontFamily }}
          >
            <div className="text-lg font-bold">{t('yourBusiness')}</div>
            <div className="text-sm">{t('fontPreviewSample')}</div>
          </div>
        )}
      </div>

      {/* Logo container — preset cards + sliders */}
      <div className="border-t border-line pt-5">
        <LogoContainerPanel
          value={theme.logoContainer ?? null}
          primary={primary}
          tenantLogoUrl={tenantLogoUrl}
          onChange={(next) => onChange({ logoContainer: next })}
        />
      </div>

      {/* Banner */}
      <div className="border-t border-line pt-5">
        <BannerPanel
          value={theme.bannerConfig ?? null}
          heroImageUrl={heroImageUrl}
          onChange={(next) => onChange({ bannerConfig: next })}
        />
      </div>

      {/* Fondo personalizable (Bloque 1 2026-06-12) — PRO */}
      <div className="border-t border-line pt-5">
        <ProLock active={!!lockPro} feature="El fondo personalizado">
          <BackgroundPanel
            value={theme.background ?? null}
            onChange={(next) => onChange({ background: next })}
          />
        </ProLock>
      </div>

      {/* Colores de texto por elemento (2026-08-19) — PRO. Aditivo. */}
      <div className="border-t border-line pt-5">
        <ProLock active={!!lockPro} feature="Los colores de texto personalizados">
          <TextColorsPanel
            value={theme.text ?? null}
            template={resolveTemplate(theme)}
            primary={primary}
            background={theme.background ?? null}
            onChange={(next) => onChange({ text: next })}
          />
        </ProLock>
      </div>

      {/* Popup promocional global — principal */}
      <div className="border-t border-line pt-5">
        <PopupPanel
          value={theme.popup ?? null}
          primary={primary}
          onChange={(next) => onChange({ popup: next })}
        />
      </div>

      {/* Popups adicionales (multi-popup, 2026-06-15) */}
      <div className="border-t border-line pt-5">
        <MultiPopupPanel
          value={theme.popups ?? []}
          primary={primary}
          onChange={(next) => onChange({ popups: next })}
        />
      </div>
    </div>
  );
}

// =====================================================
// TextColorsPanel — colores de texto por elemento (theme.text)
// -----------------------------------------------------
// Deja al negocio elegir el color de: título, descripción, texto de
// botones, el nombre del negocio (texto secundario) y el pie de
// atribución «Hecho con …» (solo el color — el texto es de la marca
// blanca y no se toca). Aditivo: un campo
// vacío usa el color por defecto del template. Pensado para que un fondo
// custom no deje el texto ilegible. El botón "Auto contraste" elige
// blanco/negro según el fondo efectivo (o el color de marca, para el botón).
// =====================================================

/** Templates con fondo oscuro por defecto (texto claro). Los demás son
 *  claros. Sirve para el "Auto" cuando no hay fondo custom. */
const DARK_TEMPLATES = new Set<InfoLinkTemplate>(['AURORA', 'NEON']);

/** Color base del fondo efectivo, para calcular contraste. Con fondo
 *  imagen asumimos oscuro (suele llevar overlay). Sin fondo custom, el
 *  default del template. */
function infoLinkBgBase(
  bg: InfoLinkBackground | null,
  template: InfoLinkTemplate,
): string {
  if (bg?.type === 'SOLID' && bg.color) return bg.color;
  if (bg?.type === 'GRADIENT' && bg.from) return bg.from;
  if (bg?.type === 'IMAGE') return '#101010';
  return DARK_TEMPLATES.has(template) ? '#1a0e2e' : '#ffffff';
}

function TextColorsPanel({
  value,
  template,
  primary,
  background,
  onChange,
}: {
  value: InfoLinkTextColors | null;
  template: InfoLinkTemplate;
  primary: string;
  background: InfoLinkBackground | null;
  onChange: (next: InfoLinkTextColors | null) => void;
}) {
  const v = value ?? {};
  const bgBase = infoLinkBgBase(background, template);

  const FIELDS: {
    key: keyof InfoLinkTextColors;
    label: string;
    against: string; // color de fondo contra el que se mide el contraste
    hint?: string;
  }[] = [
    { key: 'title', label: 'Título', against: bgBase },
    { key: 'description', label: 'Descripción', against: bgBase },
    {
      key: 'button',
      label: 'Texto de botones',
      against: primary,
      hint: 'No aplica a botones con estilo/color propio.',
    },
    { key: 'meta', label: 'Nombre del negocio', against: bgBase },
    {
      key: 'badge',
      label: 'Pie «Hecho con…»',
      against: bgBase,
      // El pie es la atribución de la marca blanca: el negocio elige el
      // color (p. ej. para que se lea sobre fondo negro), nunca el texto.
      hint: 'Solo el color. El texto y la marca no cambian.',
    },
  ];

  function setField(key: keyof InfoLinkTextColors, color: string | null) {
    const next: InfoLinkTextColors = { ...v };
    if (color) next[key] = color;
    else delete next[key];
    onChange(Object.keys(next).length === 0 ? null : next);
  }

  function applyAuto() {
    // Título/descr/nombre contrastan con el fondo; el botón, con su relleno
    // (color de marca). autoTextColor devuelve blanco o negro.
    onChange({
      title: autoTextColor(bgBase),
      description: autoTextColor(bgBase),
      meta: autoTextColor(bgBase),
      button: autoTextColor(primary),
      badge: autoTextColor(bgBase),
    });
  }

  const anySet = Object.keys(v).length > 0;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
            Colores de texto
          </div>
          <div className="text-xs text-mute mt-0.5 leading-snug">
            Personaliza el color de cada texto. Útil cuando pones un fondo
            propio. Vacío = usa el color del template.
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <button
          type="button"
          onClick={applyAuto}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-line hover:border-ink/30 hover:shadow-sm transition"
        >
          ✨ Auto contraste
        </button>
        {anySet && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg text-mute hover:text-ink transition"
          >
            Restablecer todo
          </button>
        )}
      </div>

      <div className="space-y-2.5">
        {FIELDS.map((f) => {
          const current = v[f.key] ?? null;
          const swatch = current || autoTextColor(f.against);
          const lowContrast =
            !!current && contrastRatio(current, f.against) < 4.5;
          return (
            <div key={f.key} className="flex items-center gap-3">
              <label className="relative flex-none">
                <input
                  type="color"
                  value={swatch}
                  onChange={(e) => setField(f.key, e.target.value)}
                  className="w-9 h-9 rounded-lg border border-line cursor-pointer p-0.5 bg-white"
                  aria-label={`Color de ${f.label}`}
                />
              </label>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-ink leading-tight">
                  {f.label}
                </div>
                <div className="text-[11px] leading-tight mt-0.5">
                  {current ? (
                    <span className="text-mute font-mono">{current}</span>
                  ) : (
                    <span className="text-mute">Automático (template)</span>
                  )}
                  {lowContrast && (
                    <span className="text-amber-600 ml-2">
                      ⚠ Contraste bajo
                    </span>
                  )}
                  {f.hint && (
                    <span className="text-mute/70 block">{f.hint}</span>
                  )}
                </div>
              </div>
              {current && (
                <button
                  type="button"
                  onClick={() => setField(f.key, null)}
                  className="flex-none text-mute hover:text-ink text-lg leading-none px-1"
                  aria-label={`Quitar color de ${f.label}`}
                  title="Usar color por defecto"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =====================================================
// MultiPopupPanel — gestor del array theme.popups[]
// =====================================================
function MultiPopupPanel({
  value,
  primary,
  onChange,
}: {
  value: InfoLinkPopup[];
  primary: string;
  onChange: (next: InfoLinkPopup[] | null) => void;
}) {
  const t = useTranslations('app_info_links_id');
  const items = Array.isArray(value) ? value : [];

  function addPopup() {
    const id = `p_${Date.now().toString(36)}_${Math.floor(Math.random() * 10000).toString(36)}`;
    const next: InfoLinkPopup = {
      id,
      enabled: true,
      delaySeconds: 3,
      oncePerSession: true,
      name: t('popupNumber', { n: items.length + 2 }),
    };
    onChange([...items, next]);
  }
  function updateAt(index: number, patch: InfoLinkPopup | null) {
    if (patch === null) {
      const copy = items.filter((_, i) => i !== index);
      onChange(copy.length ? copy : null);
      return;
    }
    const copy = [...items];
    copy[index] = patch;
    onChange(copy);
  }
  function moveUp(index: number) {
    if (index === 0) return;
    const copy = [...items];
    [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]];
    onChange(copy);
  }
  function moveDown(index: number) {
    if (index === items.length - 1) return;
    const copy = [...items];
    [copy[index + 1], copy[index]] = [copy[index], copy[index + 1]];
    onChange(copy);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-sm m-0">{t('additionalPopups')}</h4>
          <div className="text-[11px] text-mute mt-0.5 leading-snug">
            {t('additionalPopupsHelp')}
          </div>
        </div>
        <button
          type="button"
          onClick={addPopup}
          className="text-xs font-semibold px-3 py-1.5 rounded-full border border-line hover:bg-bg2 shrink-0"
        >
          {t('add')}
        </button>
      </div>

      {items.length === 0 && (
        <div className="text-xs text-mute text-center py-4 border border-dashed border-line2 rounded-lg">
          {t('noAdditionalPopups')}
        </div>
      )}

      {items.map((p, i) => (
        <div key={p.id ?? i} className="border border-line rounded-lg p-3 bg-bg2/30">
          <div className="flex items-center justify-between gap-2 mb-2">
            <input
              type="text"
              className="input flex-1"
              maxLength={40}
              value={p.name ?? ''}
              onChange={(e) => updateAt(i, { ...p, name: e.target.value })}
              placeholder={t('popupNumber', { n: i + 2 })}
            />
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => moveUp(i)}
                disabled={i === 0}
                className="text-xs px-2 py-1 text-mute hover:text-ink disabled:opacity-30"
                title={t('raisePriority')}
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => moveDown(i)}
                disabled={i === items.length - 1}
                className="text-xs px-2 py-1 text-mute hover:text-ink disabled:opacity-30"
                title={t('lowerPriority')}
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    confirm(t('confirmDeletePopup', { name: p.name || t('popupFallback') }))
                  ) {
                    updateAt(i, null);
                  }
                }}
                className="text-xs px-2 py-1 text-bad hover:text-bad-strong"
                title={t('delete')}
              >
                ✕
              </button>
            </div>
          </div>
          <PopupPanel
            value={p}
            primary={primary}
            onChange={(next) => updateAt(i, next ?? { ...p, enabled: false })}
          />
        </div>
      ))}
    </div>
  );
}

// =====================================================
// BackgroundPanel — fondo sólido / imagen / gradiente
// =====================================================
function BackgroundPanel({
  value,
  onChange,
}: {
  value: InfoLinkBackground | null;
  onChange: (next: InfoLinkBackground | null) => void;
}) {
  const t = useTranslations('app_info_links_id');
  const type = value?.type ?? 'NONE';

  function setType(t: 'NONE' | 'SOLID' | 'IMAGE' | 'GRADIENT') {
    if (t === 'NONE') return onChange(null);
    if (t === 'SOLID') return onChange({ type: 'SOLID', color: (value as any)?.color ?? '#0F172A' });
    if (t === 'IMAGE')
      return onChange({
        type: 'IMAGE',
        imageUrl: (value as any)?.imageUrl ?? '',
        overlay: (value as any)?.overlay ?? 30,
      });
    if (t === 'GRADIENT')
      return onChange({
        type: 'GRADIENT',
        from: (value as any)?.from ?? '#22C55E',
        to: (value as any)?.to ?? '#0EA5E9',
        angle: (value as any)?.angle ?? 180,
      });
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-semibold text-sm m-0">{t('pageBackground')}</h4>
        <div className="text-[11px] text-mute mt-0.5 leading-snug">
          {t('pageBackgroundHelp')}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {(
          [
            { id: 'NONE', label: t('bgTemplateLabel'), hint: t('bgTemplateHint') },
            { id: 'SOLID', label: t('bgColorLabel'), hint: t('bgColorHint') },
            { id: 'IMAGE', label: t('bgImageLabel'), hint: t('bgImageHint') },
            { id: 'GRADIENT', label: t('bgGradientLabel'), hint: t('bgGradientHint') },
          ] as const
        ).map((opt) => {
          const active = type === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setType(opt.id)}
              className={`text-left rounded-lg p-2.5 border transition ${
                active
                  ? 'border-brand bg-brand/5 shadow-sm'
                  : 'border-line hover:border-ink/30'
              }`}
            >
              <div className="font-semibold text-xs">{opt.label}</div>
              <div className="text-[10px] text-mute mt-0.5">{opt.hint}</div>
            </button>
          );
        })}
      </div>

      {value?.type === 'SOLID' && (
        <div>
          <label className="label">{t('solidColor')}</label>
          <input
            type="color"
            value={value.color}
            onChange={(e) => onChange({ type: 'SOLID', color: e.target.value })}
            className="w-full h-10 cursor-pointer rounded"
          />
        </div>
      )}

      {value?.type === 'IMAGE' && (
        <div className="space-y-3">
          <div>
            <label className="label">{t('bgImageField')}</label>
            <ImageUploader
              value={value.imageUrl || null}
              onChange={(url) =>
                onChange({ ...value, imageUrl: url || '' })
              }
              folder="info-links"
            />
          </div>
          <div>
            <label className="label">
              {t('darken', { pct: value.overlay ?? 0 })}
            </label>
            <input
              type="range"
              min={0}
              max={80}
              step={5}
              value={value.overlay ?? 0}
              onChange={(e) =>
                onChange({ ...value, overlay: Number(e.target.value) })
              }
              className="w-full"
            />
          </div>
        </div>
      )}

      {value?.type === 'GRADIENT' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('startColor')}</label>
              <input
                type="color"
                value={value.from}
                onChange={(e) => onChange({ ...value, from: e.target.value })}
                className="w-full h-10 cursor-pointer rounded"
              />
            </div>
            <div>
              <label className="label">{t('endColor')}</label>
              <input
                type="color"
                value={value.to}
                onChange={(e) => onChange({ ...value, to: e.target.value })}
                className="w-full h-10 cursor-pointer rounded"
              />
            </div>
          </div>
          <div>
            <label className="label">
              {t('angle', { deg: value.angle ?? 180 })}
            </label>
            <input
              type="range"
              min={0}
              max={360}
              step={15}
              value={value.angle ?? 180}
              onChange={(e) =>
                onChange({ ...value, angle: Number(e.target.value) })
              }
              className="w-full"
            />
          </div>
        </div>
      )}

      {value && (
        <div
          className="h-24 rounded-lg border border-line"
          style={{
            background:
              value.type === 'SOLID'
                ? value.color
                : value.type === 'GRADIENT'
                  ? `linear-gradient(${value.angle ?? 180}deg, ${value.from}, ${value.to})`
                  : value.type === 'IMAGE' && value.imageUrl
                    ? `linear-gradient(rgba(0,0,0,${(value.overlay ?? 0) / 100}), rgba(0,0,0,${(value.overlay ?? 0) / 100})), url("${value.imageUrl}") center/cover`
                    : undefined,
          }}
        />
      )}
    </div>
  );
}

// =====================================================
// PopupPanel — popup promocional global
// =====================================================
function PopupPanel({
  value,
  primary,
  onChange,
}: {
  value: InfoLinkPopup | null;
  primary: string;
  onChange: (next: InfoLinkPopup | null) => void;
}) {
  const t = useTranslations('app_info_links_id');
  const enabled = !!value?.enabled;

  function patch(next: Partial<InfoLinkPopup>) {
    onChange({
      enabled: true,
      delaySeconds: 3,
      oncePerSession: true,
      ...(value ?? {}),
      ...next,
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-sm m-0">{t('promoPopup')}</h4>
          <div className="text-[11px] text-mute mt-0.5 leading-snug">
            {t('promoPopupHelp')}
          </div>
        </div>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) =>
              e.target.checked
                ? patch({ enabled: true })
                : onChange({ ...(value ?? { enabled: false }), enabled: false })
            }
          />
          <span className="text-xs font-semibold">
            {enabled ? t('active') : t('off')}
          </span>
        </label>
      </div>

      {enabled && (
        <div className="space-y-3">
          <div>
            <label className="label">{t('title')}</label>
            <input
              type="text"
              className="input"
              maxLength={80}
              value={value?.title ?? ''}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder={t('popupTitlePlaceholder')}
            />
          </div>
          <div>
            <label className="label">{t('description')}</label>
            <textarea
              className="input min-h-[70px]"
              maxLength={300}
              value={value?.description ?? ''}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder={t('popupDescPlaceholder')}
            />
          </div>
          <div>
            <label className="label">{t('imageOptional')}</label>
            <ImageUploader
              value={value?.imageUrl ?? null}
              onChange={(url) => patch({ imageUrl: url ?? undefined })}
              folder="info-links"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('buttonText')}</label>
              <input
                type="text"
                className="input"
                maxLength={40}
                value={value?.buttonText ?? ''}
                onChange={(e) => patch({ buttonText: e.target.value })}
                placeholder={t('seeMore')}
              />
            </div>
            <div>
              <label className="label">{t('buttonUrl')}</label>
              <input
                type="url"
                className="input"
                value={value?.buttonUrl ?? ''}
                onChange={(e) => patch({ buttonUrl: e.target.value })}
                placeholder="https://..."
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('buttonColor')}</label>
              <input
                type="color"
                className="w-full h-10 cursor-pointer rounded"
                value={value?.buttonColor ?? primary}
                onChange={(e) => patch({ buttonColor: e.target.value })}
              />
            </div>
            <div>
              <label className="label">
                {t('delay', { sec: value?.delaySeconds ?? 3 })}
              </label>
              <input
                type="range"
                min={0}
                max={20}
                step={1}
                value={value?.delaySeconds ?? 3}
                onChange={(e) =>
                  patch({ delaySeconds: Number(e.target.value) })
                }
                className="w-full"
              />
            </div>
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer text-xs">
            <input
              type="checkbox"
              checked={value?.oncePerSession ?? true}
              onChange={(e) =>
                patch({ oncePerSession: e.target.checked })
              }
            />
            {t('oncePerSession')}
          </label>

          <PopupScheduleEditor
            schedule={value?.schedule ?? null}
            onChange={(next) => patch({ schedule: next })}
          />
        </div>
      )}
    </div>
  );
}

// =====================================================
// PopupScheduleEditor — días/fechas/horas
// =====================================================
const DAY_LABELS = [
  { num: 1, label: 'L' },
  { num: 2, label: 'M' },
  { num: 3, label: 'X' },
  { num: 4, label: 'J' },
  { num: 5, label: 'V' },
  { num: 6, label: 'S' },
  { num: 0, label: 'D' },
];
function PopupScheduleEditor({
  schedule,
  onChange,
}: {
  schedule: PopupSchedule | null;
  onChange: (next: PopupSchedule | null) => void;
}) {
  const t = useTranslations('app_info_links_id');
  const enabled = !!schedule;
  const days = schedule?.daysOfWeek ?? [];
  function toggleDay(num: number) {
    const set = new Set(days);
    if (set.has(num)) set.delete(num);
    else set.add(num);
    const arr = Array.from(set).sort();
    onChange({ ...(schedule ?? {}), daysOfWeek: arr.length === 7 ? null : arr });
  }
  return (
    <div className="border-t border-line2 pt-3 mt-2">
      <label className="inline-flex items-center gap-2 cursor-pointer text-xs">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) =>
            e.target.checked
              ? onChange({ daysOfWeek: null, startDate: null, endDate: null, startTime: null, endTime: null })
              : onChange(null)
          }
        />
        <span className="font-semibold">{t('schedule')}</span>
        <span className="text-mute">
          {t('scheduleSub')}
        </span>
      </label>

      {enabled && (
        <div className="space-y-3 mt-3">
          <div>
            <label className="label">{t('daysOfWeek')}</label>
            <div className="flex gap-1.5">
              {DAY_LABELS.map((d) => {
                const active = days.includes(d.num);
                return (
                  <button
                    key={d.num}
                    type="button"
                    onClick={() => toggleDay(d.num)}
                    className="w-9 h-9 rounded-lg text-xs font-bold"
                    style={{
                      background: active ? '#16a34a' : 'white',
                      color: active ? 'white' : '#16241c',
                      border: '1px solid #d7dbe0',
                    }}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
            <div className="text-[11px] text-mute mt-1">
              {!days || days.length === 0 || days.length === 7
                ? t('allDays')
                : t('daysSelected', { count: days.length })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('fromDate')}</label>
              <input
                type="date"
                className="input"
                value={schedule?.startDate ?? ''}
                onChange={(e) =>
                  onChange({ ...(schedule ?? {}), startDate: e.target.value || null })
                }
              />
            </div>
            <div>
              <label className="label">{t('toDate')}</label>
              <input
                type="date"
                className="input"
                value={schedule?.endDate ?? ''}
                onChange={(e) =>
                  onChange({ ...(schedule ?? {}), endDate: e.target.value || null })
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">{t('fromTime')}</label>
              <input
                type="time"
                className="input"
                value={schedule?.startTime ?? ''}
                onChange={(e) =>
                  onChange({ ...(schedule ?? {}), startTime: e.target.value || null })
                }
              />
            </div>
            <div>
              <label className="label">{t('toTime')}</label>
              <input
                type="time"
                className="input"
                value={schedule?.endTime ?? ''}
                onChange={(e) =>
                  onChange({ ...(schedule ?? {}), endTime: e.target.value || null })
                }
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================
// LogoContainerPanel — preset picker + sliders + preview
// =====================================================
//
// Panel para customizar el contenedor del logo del InfoLink. 4 presets
// rápidos (minimalista/premium/dark/glassmorphism) + sliders fine para
// padding, radius, tamaño, sombra. Vista previa en vivo sobre fondo
// neutro (no replica todo el shell — eso lo cubre la vista pública).
function LogoContainerPanel({
  value,
  primary,
  tenantLogoUrl,
  onChange,
}: {
  value: LogoContainerConfig | null;
  primary: string;
  tenantLogoUrl: string | null;
  onChange: (next: LogoContainerConfig | null) => void;
}) {
  const t = useTranslations('app_info_links_id');
  const enabled = value !== null;
  const cfg = value ?? DEFAULT_LOGO_CONTAINER;

  function patch(p: Partial<LogoContainerConfig>) {
    onChange({ ...cfg, ...p, preset: null });
  }
  function applyPreset(id: LogoContainerPresetId) {
    onChange({ ...LOGO_CONTAINER_PRESETS[id].config });
  }

  const containerProps = getLogoContainerProps(cfg, primary);
  const imgStyle = getLogoImgStyle(cfg);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold m-0 text-sm">{t('logoStyle')}</h3>
        <label className="flex items-center gap-2 text-xs text-mute cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) =>
              onChange(e.target.checked ? { ...DEFAULT_LOGO_CONTAINER } : null)
            }
          />
          {t('customize')}
        </label>
      </div>

      {!enabled && (
        <div className="text-xs text-mute leading-relaxed">
          {t('logoStyleDisabledHelp')}
        </div>
      )}

      {enabled && (
        <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-5">
          <div className="space-y-4">
            {/* Presets */}
            <div>
              <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
                {t('presets')}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  Object.keys(LOGO_CONTAINER_PRESETS) as LogoContainerPresetId[]
                ).map((id) => {
                  const p = LOGO_CONTAINER_PRESETS[id];
                  const active = cfg.preset === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => applyPreset(id)}
                      className={`text-left rounded-lg p-3 border transition ${
                        active
                          ? 'border-brand bg-brand/5'
                          : 'border-line hover:border-ink/30'
                      }`}
                    >
                      <div className="font-semibold text-sm">{p.label}</div>
                      <div className="text-[11px] text-mute mt-0.5 leading-snug">
                        {p.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Forma del contenedor */}
            <div>
              <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
                {t('shape')}
              </div>
              <div className="inline-flex rounded-pill bg-bg2 p-0.5 text-xs font-semibold">
                {(['circle', 'rounded'] as const).map((s) => {
                  const current = (cfg.shape ?? 'circle') === s;
                  const label = s === 'circle' ? t('shapeCircle') : t('shapeRounded');
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => patch({ shape: s })}
                      className={`px-3 py-1.5 rounded-pill transition ${
                        current
                          ? 'bg-white text-ink shadow-sm'
                          : 'text-mute hover:text-ink'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Sliders */}
            <div className="space-y-3">
              <SliderRow
                label={
                  (cfg.shape ?? 'circle') === 'circle'
                    ? t('circleSize')
                    : t('maxWidth')
                }
                min={80}
                max={280}
                value={cfg.maxWidth}
                onChange={(v) => patch({ maxWidth: v })}
                unit="px"
              />
              <SliderRow
                label={t('paddingHorizontal')}
                min={0}
                max={40}
                value={cfg.paddingX}
                onChange={(v) => patch({ paddingX: v })}
                unit="px"
              />
              <SliderRow
                label={t('paddingVertical')}
                min={0}
                max={40}
                value={cfg.paddingY}
                onChange={(v) => patch({ paddingY: v })}
                unit="px"
              />
              {(cfg.shape ?? 'circle') === 'rounded' && (
                <SliderRow
                  label={t('borderRadius')}
                  min={0}
                  max={40}
                  value={cfg.borderRadius}
                  onChange={(v) => patch({ borderRadius: v })}
                  unit="px"
                />
              )}
              <SliderRow
                label={t('bgOpacity')}
                min={0}
                max={100}
                value={Math.round(cfg.bgOpacity * 100)}
                onChange={(v) => patch({ bgOpacity: v / 100 })}
                unit="%"
              />
              <SliderRow
                label={t('bgBlur')}
                min={0}
                max={30}
                value={cfg.backdropBlur}
                onChange={(v) => patch({ backdropBlur: v })}
                unit="px"
              />
              <SliderRow
                label={t('ringWidth')}
                min={0}
                max={8}
                value={cfg.ringWidth}
                onChange={(v) => patch({ ringWidth: v })}
                unit="px"
              />
            </div>

            {/* Color de fondo + sombra */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label text-xs">{t('bgColor')}</label>
                <input
                  type="color"
                  className="input h-11 p-1"
                  value={cfg.bgColor}
                  onChange={(e) => patch({ bgColor: e.target.value })}
                />
              </div>
              <div>
                <label className="label text-xs">{t('shadow')}</label>
                <select
                  className="input"
                  value={cfg.shadow}
                  onChange={(e) =>
                    patch({ shadow: e.target.value as LogoContainerConfig['shadow'] })
                  }
                >
                  <option value="none">{t('shadowNone')}</option>
                  <option value="sm">{t('shadowSm')}</option>
                  <option value="md">{t('shadowMd')}</option>
                  <option value="lg">{t('shadowLg')}</option>
                  <option value="xl">{t('shadowXl')}</option>
                  <option value="glow">{t('shadowGlow')}</option>
                </select>
              </div>
            </div>
          </div>

          {/* Preview */}
          <div className="lg:sticky lg:top-4">
            <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2 text-center">
              {t('preview')}
            </div>
            <div
              className="rounded-xl flex items-center justify-center min-h-[180px] p-6"
              style={{
                background:
                  cfg.preset === 'dark' || cfg.preset === 'glassmorphism'
                    ? `linear-gradient(135deg, ${primary}40, #1a1a2e)`
                    : '#F3F4F6',
              }}
            >
              {tenantLogoUrl ? (
                <div className={containerProps.className} style={containerProps.style}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={tenantLogoUrl} alt="logo" style={imgStyle} />
                </div>
              ) : (
                <div className="text-xs text-mute italic">
                  {t('uploadLogoHint')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SliderRow({
  label,
  min,
  max,
  value,
  onChange,
  unit,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
  unit: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-mute">{label}</span>
        <span className="font-mono text-ink">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-brand"
      />
    </div>
  );
}

// =====================================================
// BannerPanel — overlay, posición, zoom, blur del hero image
// =====================================================
//
// Aplica al template SHOP (único shell que renderea heroImageUrl hoy).
// Si bannerConfig=null, el hero se renderea con el overlay negro 15%
// histórico (legible pero sin tunear). Activa "Personalizar" para
// elegir preset o tunear fino.
function BannerPanel({
  value,
  heroImageUrl,
  onChange,
}: {
  value: BannerConfig | null;
  heroImageUrl: string | null;
  onChange: (next: BannerConfig | null) => void;
}) {
  const t = useTranslations('app_info_links_id');
  const enabled = value !== null;
  const cfg = value ?? DEFAULT_BANNER_CONFIG;

  function patch(p: Partial<BannerConfig>) {
    onChange({ ...cfg, ...p, preset: null });
  }
  function patchOverlay(p: Partial<BannerConfig['overlay']>) {
    onChange({ ...cfg, overlay: { ...cfg.overlay, ...p }, preset: null });
  }
  function applyPreset(id: BannerPresetId) {
    onChange({ ...BANNER_PRESETS[id].config });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold m-0 text-sm">{t('banner')}</h3>
        <label className="flex items-center gap-2 text-xs text-mute cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) =>
              onChange(e.target.checked ? { ...DEFAULT_BANNER_CONFIG } : null)
            }
          />
          {t('customize')}
        </label>
      </div>

      {!heroImageUrl && (
        <div className="text-xs text-mute italic mb-3">
          {t('uploadHeroForPreview')}
        </div>
      )}

      {!enabled && (
        <div className="text-xs text-mute leading-relaxed">
          {t('bannerDisabledHelp')}
        </div>
      )}

      {enabled && (
        <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-5">
          <div className="space-y-4">
            {/* Presets */}
            <div>
              <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2">
                {t('presets')}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(BANNER_PRESETS) as BannerPresetId[]).map((id) => {
                  const p = BANNER_PRESETS[id];
                  const active = cfg.preset === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => applyPreset(id)}
                      className={`text-left rounded-lg p-3 border transition ${
                        active
                          ? 'border-brand bg-brand/5'
                          : 'border-line hover:border-ink/30'
                      }`}
                    >
                      <div className="font-semibold text-sm">{p.label}</div>
                      <div className="text-[11px] text-mute mt-0.5 leading-snug">
                        {p.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Posición */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label text-xs">{t('position')}</label>
                <select
                  className="input"
                  value={cfg.position}
                  onChange={(e) =>
                    patch({ position: e.target.value as BannerPosition })
                  }
                >
                  <option value="center">{t('positionCenter')}</option>
                  <option value="top">{t('positionTop')}</option>
                  <option value="bottom">{t('positionBottom')}</option>
                  <option value="left">{t('positionLeft')}</option>
                  <option value="right">{t('positionRight')}</option>
                  <option value="custom">{t('positionCustom')}</option>
                </select>
              </div>
              <div>
                <label className="label text-xs">{t('overlay')}</label>
                <select
                  className="input"
                  value={cfg.overlay.type}
                  onChange={(e) =>
                    patchOverlay({
                      type: e.target.value as BannerConfig['overlay']['type'],
                    })
                  }
                >
                  <option value="none">{t('overlayNone')}</option>
                  <option value="solid">{t('overlaySolid')}</option>
                  <option value="gradient">{t('overlayGradient')}</option>
                </select>
              </div>
            </div>

            {cfg.position === 'custom' && (
              <div className="space-y-3">
                <SliderRow
                  label={t('offsetX')}
                  min={-50}
                  max={50}
                  value={cfg.offsetX}
                  onChange={(v) => patch({ offsetX: v })}
                  unit="%"
                />
                <SliderRow
                  label={t('offsetY')}
                  min={-50}
                  max={50}
                  value={cfg.offsetY}
                  onChange={(v) => patch({ offsetY: v })}
                  unit="%"
                />
              </div>
            )}

            <div className="space-y-3">
              <SliderRow
                label={t('zoom')}
                min={100}
                max={300}
                value={Math.round(cfg.scale * 100)}
                onChange={(v) => patch({ scale: v / 100 })}
                unit="%"
              />
              <SliderRow
                label={t('blur')}
                min={0}
                max={20}
                value={cfg.blur}
                onChange={(v) => patch({ blur: v })}
                unit="px"
              />
            </div>

            {/* Overlay controls */}
            {cfg.overlay.type === 'solid' && (
              <div className="grid grid-cols-[120px_1fr] gap-3 items-end">
                <div>
                  <label className="label text-xs">{t('overlayColor')}</label>
                  <input
                    type="color"
                    className="input h-11 p-1"
                    value={cfg.overlay.color}
                    onChange={(e) => patchOverlay({ color: e.target.value })}
                  />
                </div>
                <SliderRow
                  label={t('overlayOpacity')}
                  min={0}
                  max={100}
                  value={Math.round(cfg.overlay.opacity * 100)}
                  onChange={(v) => patchOverlay({ opacity: v / 100 })}
                  unit="%"
                />
              </div>
            )}

            {cfg.overlay.type === 'gradient' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label text-xs">{t('gradientFrom')}</label>
                    <input
                      type="text"
                      className="input text-xs"
                      placeholder="rgba(0,0,0,0)"
                      value={cfg.overlay.gradientFrom}
                      onChange={(e) =>
                        patchOverlay({ gradientFrom: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="label text-xs">{t('gradientTo')}</label>
                    <input
                      type="text"
                      className="input text-xs"
                      placeholder="rgba(0,0,0,0.7)"
                      value={cfg.overlay.gradientTo}
                      onChange={(e) =>
                        patchOverlay({ gradientTo: e.target.value })
                      }
                    />
                  </div>
                </div>
                <SliderRow
                  label={t('gradientAngle')}
                  min={0}
                  max={360}
                  value={cfg.overlay.gradientAngle}
                  onChange={(v) => patchOverlay({ gradientAngle: v })}
                  unit="°"
                />
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="lg:sticky lg:top-4">
            <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2 text-center">
              {t('preview')}
            </div>
            <div className="relative h-40 rounded-xl overflow-hidden border border-line">
              {heroImageUrl ? (
                <>
                  <div
                    className="absolute inset-0"
                    style={getBannerBackgroundStyle(
                      heroImageUrl,
                      cfg,
                      'linear-gradient(135deg, #999, #ccc)',
                    )}
                  />
                  {cfg.overlay.type !== 'none' && (
                    <div
                      className="absolute inset-0"
                      style={{ background: getBannerOverlayBackground(cfg) }}
                    />
                  )}
                </>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-mute italic bg-bg2">
                  {t('uploadImageFirst')}
                </div>
              )}
            </div>
            <div className="text-[10px] text-mute mt-2 text-center leading-snug">
              {t('bannerPreviewHint')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================
// PopupEditor — config del popup que abre el botón type='POPUP'
// =====================================================
function PopupEditor({
  value,
  primary,
  onChange,
  cards,
}: {
  value: PopupConfig | null;
  primary: string;
  onChange: (next: PopupConfig) => void;
  /** Tarjetas de fidelización del tenant para el selector wallet (G3).
   *  Si el array está vacío, el selector muestra texto explicativo
   *  pidiendo crear una tarjeta primero. */
  cards?: Array<{ id: string; name: string }>;
}) {
  const t = useTranslations('app_info_links_id');
  const cfg = value ?? DEFAULT_POPUP_CONFIG;
  function patch(p: Partial<PopupConfig>) {
    onChange({ ...cfg, ...p });
  }
  function applyTemplate(id: PopupTemplateId) {
    onChange({ ...POPUP_TEMPLATES[id].config });
  }
  const ctaColor = cfg.ctaColor || primary;

  return (
    <div className="space-y-4">
      <div className="text-[11px] uppercase tracking-wider text-mute font-semibold">
        {t('popupContent')}
      </div>

      <div>
        <div className="text-xs text-mute mb-1.5">
          {t('quickTemplates')}
        </div>
        <div className="flex gap-2 flex-wrap">
          {(Object.keys(POPUP_TEMPLATES) as PopupTemplateId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => applyTemplate(id)}
              className="text-xs px-2.5 py-1.5 rounded-md border border-line hover:border-ink/30 hover:bg-bg2 transition"
            >
              {POPUP_TEMPLATES[id].label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-5">
        <div className="space-y-3">
          <div>
            <label className="label text-xs">{t('title')}</label>
            <input
              className="input"
              value={cfg.title}
              onChange={(e) => patch({ title: e.target.value })}
              maxLength={80}
            />
          </div>
          <div>
            <label className="label text-xs">{t('description')}</label>
            <textarea
              className="input"
              rows={4}
              value={cfg.description}
              onChange={(e) => patch({ description: e.target.value })}
              maxLength={500}
              placeholder={t('popupEditorDescPlaceholder')}
            />
          </div>
          <div>
            <label className="label text-xs">{t('imageOptional')}</label>
            <ImageUploader
              value={cfg.imageUrl}
              onChange={(url) => patch({ imageUrl: url })}
              folder="info-links"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label text-xs">{t('buttonTextOptional')}</label>
              <input
                className="input"
                value={cfg.ctaText}
                onChange={(e) => patch({ ctaText: e.target.value })}
                placeholder={t('ctaTextPlaceholder')}
                maxLength={40}
              />
            </div>
            <div>
              <label className="label text-xs">{t('buttonLink')}</label>
              <input
                className="input"
                value={cfg.ctaUrl}
                onChange={(e) => patch({ ctaUrl: e.target.value })}
                placeholder={t('ctaUrlPlaceholder')}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="label text-xs">{t('colorBg')}</label>
              <input
                type="color"
                className="input h-10 p-1"
                value={cfg.bgColor}
                onChange={(e) => patch({ bgColor: e.target.value })}
              />
            </div>
            <div>
              <label className="label text-xs">{t('colorText')}</label>
              <input
                type="color"
                className="input h-10 p-1"
                value={cfg.textColor}
                onChange={(e) => patch({ textColor: e.target.value })}
              />
            </div>
            <div>
              <label className="label text-xs">{t('colorButton')}</label>
              <input
                type="color"
                className="input h-10 p-1"
                value={cfg.ctaColor || primary}
                onChange={(e) => patch({ ctaColor: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label text-xs">{t('size')}</label>
              <select
                className="input"
                value={cfg.size}
                onChange={(e) =>
                  patch({ size: e.target.value as PopupConfig['size'] })
                }
              >
                <option value="sm">{t('sizeSm')}</option>
                <option value="md">{t('sizeMd')}</option>
                <option value="lg">{t('sizeLg')}</option>
              </select>
            </div>
            <div>
              <label className="label text-xs">{t('shadow')}</label>
              <select
                className="input"
                value={cfg.shadow}
                onChange={(e) =>
                  patch({ shadow: e.target.value as PopupConfig['shadow'] })
                }
              >
                <option value="none">{t('shadowNone')}</option>
                <option value="sm">{t('shadowSm')}</option>
                <option value="md">{t('shadowMd')}</option>
                <option value="lg">{t('shadowLg')}</option>
                <option value="xl">{t('shadowXl')}</option>
              </select>
            </div>
          </div>
          <SliderRow
            label={t('roundedCorners')}
            min={0}
            max={40}
            value={cfg.borderRadius}
            onChange={(v) => patch({ borderRadius: v })}
            unit="px"
          />
          <label className="flex items-center gap-2 text-xs text-mute cursor-pointer">
            <input
              type="checkbox"
              checked={cfg.closeOnOutside}
              onChange={(e) => patch({ closeOnOutside: e.target.checked })}
            />
            {t('closeOnOutside')}
          </label>

          {/* G3: selector de tarjeta de fidelización. Cuando está
              seleccionada, el modal renderea un botón "Instalar tarjeta"
              que abre /c/<cardId>. Pensado para convertir el popup en
              herramienta comercial ("Antes de reservar, instala nuestra
              tarjeta"). */}
          <div className="pt-3 border-t border-line2">
            <label className="label text-xs">{t('loyaltyCardOptional')}</label>
            {(cards ?? []).length === 0 ? (
              <p className="text-[11px] text-mute leading-relaxed">
                {t('noCardsBefore')}{' '}
                <a href="/app/cards" className="underline text-brand">
                  {t('cardsLink')}
                </a>{' '}
                {t('noCardsAfter')}
              </p>
            ) : (
              <>
                <select
                  className="input"
                  value={cfg.walletCardId ?? ''}
                  onChange={(e) =>
                    patch({ walletCardId: e.target.value || null })
                  }
                >
                  <option value="">{t('noCardHidden')}</option>
                  {(cards ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-mute mt-1 leading-relaxed">
                  {t('loyaltyCardHelp')}
                </p>
                {cfg.walletCardId && (
                  <input
                    className="input mt-2"
                    placeholder={t('installCardPlaceholder')}
                    value={cfg.walletCardLabel ?? ''}
                    onChange={(e) =>
                      patch({ walletCardLabel: e.target.value })
                    }
                    maxLength={60}
                  />
                )}
              </>
            )}
          </div>

          {/* G3: auto-close timer. 0 = manual close only. */}
          <div className="pt-3 border-t border-line2">
            <label className="label text-xs">{t('autoCloseOptional')}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={60}
                className="input w-24"
                value={cfg.autoCloseSeconds ?? 0}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  patch({
                    autoCloseSeconds: !isNaN(n) && n > 0 ? n : null,
                  });
                }}
              />
              <span className="text-xs text-mute">
                {t('autoCloseSecondsHint')}
              </span>
            </div>
          </div>
        </div>

        {/* Preview mini */}
        <div className="lg:sticky lg:top-4">
          <div className="text-[11px] uppercase tracking-wider text-mute font-semibold mb-2 text-center">
            {t('preview')}
          </div>
          <div
            className="rounded-xl p-4 bg-ink/80 flex items-center justify-center"
            style={{ minHeight: 200 }}
          >
            <div
              style={{
                background: cfg.bgColor,
                color: cfg.textColor,
                borderRadius: `${cfg.borderRadius}px`,
                boxShadow: popupShadowCss(cfg.shadow),
                width: '100%',
                maxWidth: `${Math.min(220, popupMaxWidthPx(cfg.size))}px`,
              }}
            >
              {cfg.imageUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={cfg.imageUrl}
                  alt=""
                  style={{
                    width: '100%',
                    maxHeight: 100,
                    objectFit: 'cover',
                    borderTopLeftRadius: `${cfg.borderRadius}px`,
                    borderTopRightRadius: `${cfg.borderRadius}px`,
                  }}
                />
              )}
              <div className="px-3 py-2.5">
                <div className="font-bold text-sm leading-tight">
                  {cfg.title || t('title')}
                </div>
                {cfg.description && (
                  <div className="text-[11px] mt-1 leading-snug whitespace-pre-line opacity-90">
                    {cfg.description}
                  </div>
                )}
                {cfg.ctaText && (
                  <div
                    className="mt-2 text-center text-[11px] font-semibold py-1.5 rounded-md text-white"
                    style={{ background: ctaColor }}
                  >
                    {cfg.ctaText}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="text-[10px] text-mute mt-2 text-center leading-snug">
            {t('popupOpenHint')}
          </div>
        </div>
      </div>
    </div>
  );
}


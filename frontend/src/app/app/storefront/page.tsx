'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { api, getUser } from '@/lib/api';
import { resolveMainSectionLabel } from '@/lib/business-categories';
import { Icon } from '@/components/Icon';
import { ImageUploader } from '@/components/ImageUploader';
import { toast } from '@/components/Toast';
import { MenuPopupsCard } from '@/components/MenuPopupsCard';
import type { StorefrontPopupItem } from '@/lib/storefront-popups';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type MenuLayout =
  | 'CLASSIC'
  | 'GRID'
  | 'CAROUSELS'
  | 'CLEAN'
  | 'COMPACT'
  | 'CLUVI'
  | 'SECTIONS';

type Storefront = {
  id: string;
  description: string;
  heroImageUrl: string | null;
  theme: any;
  blocks: any[];
  isPublished: boolean;
  menuLayout: MenuLayout;
  customDomain: string | null;
  popupEnabled?: boolean;
  popupImageUrl?: string | null;
  popupCardId?: string | null;
  popupDelaySeconds?: number;
  whatsappButtonEnabled?: boolean;
  instagramButtonEnabled?: boolean;
  pageBackgroundColor?: string | null;
  pageBackgroundType?: string | null;
  pageBackgroundGradient?: string | null;
  pageBackgroundImageUrl?: string | null;
  logoBgColor?: string | null;
  titleColor?: string | null;
  descriptionColor?: string | null;
  backButtonConfig?: BackButtonCfg | null;
};

type BackButtonCfg = {
  bgColor?: string;
  iconColor?: string;
  opacity?: number;
  borderColor?: string;
  borderWidth?: number;
  shadow?: 'none' | 'sm' | 'md' | 'lg';
  size?: number;
};

/** Lista curada de países (LATAM-first) con dial code y longitud típica
 *  del número local. Si necesitamos más, sumarlos aquí — el formato es
 *  estable. dial sin "+" para que `+${dial}${local}` sea trivial. */
const COUNTRY_CODES: {
  code: string;
  flag: string;
  name: string;
  dial: string;
  maxLen: number;
}[] = [
  { code: 'CO', flag: '🇨🇴', name: 'Colombia', dial: '57', maxLen: 10 },
  { code: 'MX', flag: '🇲🇽', name: 'México', dial: '52', maxLen: 10 },
  { code: 'AR', flag: '🇦🇷', name: 'Argentina', dial: '54', maxLen: 10 },
  { code: 'CL', flag: '🇨🇱', name: 'Chile', dial: '56', maxLen: 9 },
  { code: 'PE', flag: '🇵🇪', name: 'Perú', dial: '51', maxLen: 9 },
  { code: 'EC', flag: '🇪🇨', name: 'Ecuador', dial: '593', maxLen: 9 },
  { code: 'VE', flag: '🇻🇪', name: 'Venezuela', dial: '58', maxLen: 10 },
  { code: 'UY', flag: '🇺🇾', name: 'Uruguay', dial: '598', maxLen: 9 },
  { code: 'PY', flag: '🇵🇾', name: 'Paraguay', dial: '595', maxLen: 9 },
  { code: 'BO', flag: '🇧🇴', name: 'Bolivia', dial: '591', maxLen: 8 },
  { code: 'BR', flag: '🇧🇷', name: 'Brasil', dial: '55', maxLen: 11 },
  { code: 'PA', flag: '🇵🇦', name: 'Panamá', dial: '507', maxLen: 8 },
  { code: 'CR', flag: '🇨🇷', name: 'Costa Rica', dial: '506', maxLen: 8 },
  { code: 'GT', flag: '🇬🇹', name: 'Guatemala', dial: '502', maxLen: 8 },
  { code: 'SV', flag: '🇸🇻', name: 'El Salvador', dial: '503', maxLen: 8 },
  { code: 'HN', flag: '🇭🇳', name: 'Honduras', dial: '504', maxLen: 8 },
  { code: 'NI', flag: '🇳🇮', name: 'Nicaragua', dial: '505', maxLen: 8 },
  { code: 'DO', flag: '🇩🇴', name: 'Rep. Dominicana', dial: '1', maxLen: 10 },
  { code: 'US', flag: '🇺🇸', name: 'EE.UU.', dial: '1', maxLen: 10 },
  { code: 'ES', flag: '🇪🇸', name: 'España', dial: '34', maxLen: 9 },
];

/** Parsea un whatsappPhone (con o sin "+", con cualquier separador) en
 *  { dial, local }. Si no matchea ningún país conocido, asume CO + el
 *  número entero como local — el dueño puede corregir desde el selector. */
function parsePhone(raw: string | null | undefined): {
  dial: string;
  local: string;
} {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!digits) return { dial: '57', local: '' };
  // Probamos los dial codes de mayor a menor longitud para evitar que
  // "1" matchee "13xxx" (Brasil) antes que "57" / "593".
  const sorted = [...COUNTRY_CODES].sort(
    (a, b) => b.dial.length - a.dial.length,
  );
  for (const c of sorted) {
    if (digits.startsWith(c.dial)) {
      return { dial: c.dial, local: digits.slice(c.dial.length) };
    }
  }
  return { dial: '57', local: digits };
}

const MENU_LAYOUTS: { id: MenuLayout; emoji: string; label: string; sub: string }[] = [
  { id: 'CLASSIC', emoji: '📋', label: 'Clásico', sub: 'Foto + info, estilo Rappi/UberEats' },
  { id: 'GRID', emoji: '🖼️', label: 'Grid', sub: 'Cuadrícula 2 columnas, fotos grandes' },
  { id: 'CAROUSELS', emoji: '🎬', label: 'Carruseles', sub: 'Hero + scroll horizontal por categoría' },
  { id: 'CLEAN', emoji: '✒️', label: 'Limpio', sub: 'Sin fotos, serif elegante (boutique)' },
  { id: 'COMPACT', emoji: '📱', label: 'Compacto', sub: 'Lista + modal con variantes (DoorDash)' },
  { id: 'CLUVI', emoji: '🌙', label: 'Fondo oscuro', sub: 'Fondo negro + cards blancas + acentos color de marca' },
  { id: 'SECTIONS', emoji: '✨', label: 'Secciones premium', sub: 'Banners grandes por sección con portada editable (Apps premium)' },
  // FLIPBOOK ya no es un layout — el menú libro vive en su propia ruta
  // (/book/<slug>) y se administra desde /app/menu-book con su propio
  // toggle bookMenuEnabled. Ver F5.2.
];

export default function StorefrontEditor() {
  const t = useTranslations('app_storefront');
  const [sf, setSf] = useState<Storefront | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string>('');
  const [brandName, setBrandName] = useState<string>(t('defaultBrandName'));
  const [mainLabel, setMainLabel] = useState<string>('Menú');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoDirty, setLogoDirty] = useState(false);
  // Campos del tenant editables desde aquí. Se persisten contra
  // PATCH /tenants/me en save() — separados del PATCH a /storefront.
  const [whatsappPhone, setWhatsappPhone] = useState<string>('');
  const [primaryColor, setPrimaryColor] = useState<string>('#22C55E');
  const [tenantDirty, setTenantDirty] = useState(false);
  // Fix 2026-06-08: con la separación de rutas /m vs /d, el link
  // "público" que se comparte para PEDIR es delivery (/d), no mesa.
  // publicUrl/publicHref ahora apuntan a delivery para el botón "Ver
  // delivery" y "Copiar link". Antes ambos caían en /m/ y abría el
  // menú mesa por error.
  const publicUrl =
    (typeof window !== 'undefined' ? window.location.host : 'clubify.app') +
    (tenantSlug ? `/d/${tenantSlug}` : '');
  const publicHref = tenantSlug ? `/d/${tenantSlug}` : '#';
  const mesaHref = tenantSlug ? `/m/${tenantSlug}` : '#';

  async function load() {
    setLoadErr(null);
    try {
      const [data, me] = await Promise.all([
        api<Storefront>('/storefront'),
        api<any>('/tenants/me').catch(() => null),
      ]);
      // Filtra el bloque 'cards' (deprecado): la tarjeta de fidelización ya no
      // se promociona en el storefront. El cliente la accede vía la pestaña
      // "Mi tarjeta" o por su link wallet directo.
      const blocks = (data.blocks ?? []).filter((b: any) => b?.type !== 'cards');
      setSf({ ...data, blocks });
      if (me?.slug) setTenantSlug(me.slug);
      if (me?.brandName) setBrandName(me.brandName);
      setMainLabel(
        resolveMainSectionLabel(
          me?.mainSectionLabelOverride,
          me?.businessCategorySlug,
        ),
      );
      if (me?.logoUrl !== undefined) setLogoUrl(me.logoUrl ?? null);
      if (me?.whatsappPhone !== undefined) setWhatsappPhone(me.whatsappPhone ?? '');
      if (me?.primaryColor !== undefined) setPrimaryColor(me.primaryColor ?? '#22C55E');
      setLogoDirty(false);
      setTenantDirty(false);
    } catch (e: any) {
      // Antes el catch faltaba — si /storefront fallaba (403 staff,
      // 500, network), sf quedaba null y la página se quedaba en
      // "Cargando..." para siempre sin pista. Ahora mostramos el
      // mensaje del backend y dejamos un botón para reintentar.
      setLoadErr(e?.message || t('loadError'));
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!sf) return;
    setSaving(true);
    try {
      await api('/storefront', {
        method: 'PATCH',
        body: JSON.stringify({
          description: sf.description,
          heroImageUrl: sf.heroImageUrl,
          theme: sf.theme,
          blocks: sf.blocks,
          isPublished: sf.isPublished,
          menuLayout: sf.menuLayout,
          customDomain: sf.customDomain || null,
          popupEnabled: sf.popupEnabled ?? false,
          popupImageUrl: sf.popupImageUrl ?? null,
          popupCardId: sf.popupCardId ?? null,
          popupDelaySeconds: sf.popupDelaySeconds ?? 10,
          whatsappButtonEnabled: sf.whatsappButtonEnabled ?? true,
          instagramButtonEnabled: sf.instagramButtonEnabled ?? true,
          pageBackgroundColor: sf.pageBackgroundColor ?? null,
          pageBackgroundType: sf.pageBackgroundType ?? null,
          pageBackgroundGradient: sf.pageBackgroundGradient ?? null,
          pageBackgroundImageUrl: sf.pageBackgroundImageUrl ?? null,
          logoBgColor: sf.logoBgColor ?? null,
          titleColor: sf.titleColor ?? null,
          descriptionColor: sf.descriptionColor ?? null,
          backButtonConfig: sf.backButtonConfig ?? null,
        }),
      });
      // Tenant fields (logo + whatsappPhone + primaryColor) van en una
      // sola PATCH si alguno cambió. Sino se skipea para no pegarle al
      // server gratis.
      if (logoDirty || tenantDirty) {
        const tenantPatch: Record<string, any> = {};
        if (logoDirty) tenantPatch.logoUrl = logoUrl ?? '';
        if (tenantDirty) {
          tenantPatch.whatsappPhone = whatsappPhone;
          tenantPatch.primaryColor = primaryColor;
        }
        await api('/tenants/me', {
          method: 'PATCH',
          body: JSON.stringify(tenantPatch),
        });
        setLogoDirty(false);
        setTenantDirty(false);
      }
      setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  }

  if (loadErr) {
    return (
      <div className="card card-pad max-w-lg mx-auto mt-8 text-center space-y-3">
        <div className="text-3xl">⚠️</div>
        <div className="font-semibold">{t('loadErrorHeading', { label: mainLabel.toLowerCase() })}</div>
        <div className="text-sm text-mute break-words">{loadErr}</div>
        <button type="button" onClick={load} className="btn-primary">
          {t('retry')}
        </button>
      </div>
    );
  }
  if (!sf) return <div className="text-mute">{t('loading')}</div>;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {t('configureTitle', { label: mainLabel.toLowerCase() })}{' '}
          <span className="page-crumb">/ {sf.isPublished ? t('published') : t('draft')}</span>
        </h1>
        <div className="flex gap-2 flex-wrap items-center">
          <Link
            href={mesaHref}
            target="_blank"
            className={`btn-ghost ${!tenantSlug ? 'pointer-events-none opacity-50' : ''}`}
            title={t('viewTableTitle', { label: mainLabel.toLowerCase() })}
          >
            🍽 {t('viewTable', { label: mainLabel.toLowerCase() })}
          </Link>
          <Link
            href="/app/marketing/qr-menu"
            className={`btn-ghost ${!tenantSlug ? 'pointer-events-none opacity-50' : ''}`}
            title={t('qrPosterTitle', { label: mainLabel.toLowerCase() })}
          >
            🖨 {t('qrLabel', { label: mainLabel })}
          </Link>
          <Link
            href={publicHref}
            target="_blank"
            className={`btn-ghost ${!tenantSlug ? 'pointer-events-none opacity-50' : ''}`}
            title={t('viewDeliveryTitle', { label: mainLabel.toLowerCase() })}
          >
            🛵 {t('viewDelivery', { label: mainLabel.toLowerCase() })}
          </Link>
          <button
            type="button"
            disabled={!tenantSlug}
            onClick={async () => {
              if (!tenantSlug) return;
              // Fix 2026-06-08: el link "delivery" copiado tiene que ser
              // /d/<slug>, no /m/<slug> (que es mesa).
              const url = `${window.location.origin}/d/${tenantSlug}`;
              try {
                await navigator.clipboard.writeText(url);
                toast(t('linkCopied'), 'success');
              } catch {
                toast(t('linkCopyFailed'), 'error');
              }
            }}
            className="btn-ghost disabled:opacity-50"
            title={t('copyLinkTitle')}
          >
            📋 {t('copyLink')}
          </button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            <Icon name="check" /> {saving ? t('saving') : t('publishChanges')}
          </button>
        </div>
      </div>

      {savedAt && (
        <div className="rounded-lg bg-ok-soft text-ok-ink px-3 py-2 mb-4 text-sm">
          ✓ {t('savedAt', { time: savedAt.toLocaleTimeString('es-CO') })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card card-pad">
          <h3 className="text-base font-semibold m-0 mb-4">{t('generalInfo')}</h3>
          <div>
            <label className="label">{t('shortDescription')}</label>
            <textarea
              className="input"
              placeholder={t('descriptionPlaceholder')}
              value={sf.description ?? ''}
              onChange={(e) => setSf({ ...sf, description: e.target.value })}
            />
          </div>

          <div className="mt-4">
            <label className="label">{t('logo')}</label>
            <ImageUploader
              value={logoUrl}
              onChange={(url) => {
                setLogoUrl(url);
                setLogoDirty(true);
              }}
              folder="logos"
            />
            <p className="text-[11px] text-mute mt-1.5">
              {t('logoHint')}
            </p>
          </div>
          <div className="mt-3">
            <label className="label">{t('status')}</label>
            <select
              className="input"
              value={sf.isPublished ? '1' : '0'}
              onChange={(e) =>
                setSf({ ...sf, isPublished: e.target.value === '1' })
              }
            >
              <option value="1">{t('published')}</option>
              <option value="0">{t('draftHidden')}</option>
            </select>
          </div>

          <h3 className="text-base font-semibold mt-6 mb-3">{t('styleHeading', { label: mainLabel.toLowerCase() })}</h3>
          <p className="text-mute text-xs mb-3">
            {t('styleHint')}{' '}
            <a
              href="/preview/menus"
              target="_blank"
              className="text-brand hover:underline"
            >
              {t('viewStyles')}
            </a>
          </p>
          <div className="grid grid-cols-2 gap-2">
            {MENU_LAYOUTS.map((opt) => {
              const active = (sf.menuLayout ?? 'CLASSIC') === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSf({ ...sf, menuLayout: opt.id })}
                  className={`text-left px-3 py-2.5 rounded-xl border-2 transition ${
                    active
                      ? 'border-brand bg-brand-soft'
                      : 'border-line hover:border-brand/40 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{opt.emoji}</span>
                    <div className="font-semibold text-sm">{opt.label}</div>
                    {active && (
                      <span className="ml-auto text-[10px] bg-brand text-white font-bold px-1.5 py-0.5 rounded">
                        ✓
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-mute mt-1 leading-snug">{opt.sub}</div>
                </button>
              );
            })}
          </div>

          {/* Fondo de la página pública: 3 tipos (sólido / gradiente /
              imagen). El viewer aplica el tipo según pageBackgroundType.
              Compat: storefronts viejos quedan con type=null → SOLID. */}
          <h3 className="text-base font-semibold mt-6 mb-3">🖌 {t('pageBackground')}</h3>
          <p className="text-mute text-xs mb-3 leading-relaxed">
            {t('pageBackgroundHint', { label: mainLabel.toLowerCase() })}
          </p>
          <PageBackgroundEditor
            type={(sf.pageBackgroundType as any) ?? 'SOLID'}
            color={sf.pageBackgroundColor ?? ''}
            gradient={sf.pageBackgroundGradient ?? ''}
            imageUrl={sf.pageBackgroundImageUrl ?? ''}
            isCluvi={(sf.menuLayout ?? 'CLASSIC') === 'CLUVI'}
            onChange={(patch) => setSf({ ...sf, ...patch })}
          />

          {/* Colores del header público — contenedor del logo + título +
              descripción. Permiten matchear el branding cuando el logo o
              los textos no contrastan con el fondo default (blanco). NULL
              en los 3 = comportamiento histórico. */}
          <h3 className="text-base font-semibold mt-6 mb-3">🖼 {t('headerLogoText')}</h3>
          <p className="text-mute text-xs mb-3 leading-relaxed">
            {t('headerLogoTextHint', { label: mainLabel.toLowerCase() })}
          </p>
          <div className="space-y-4">
            <HeaderColorRow
              label={t('logoBgLabel')}
              hint={t('logoBgHint')}
              value={sf.logoBgColor ?? ''}
              defaultLabel={t('colorWhite')}
              defaultColor="#FFFFFF"
              allowTransparent
              presets={[
                { color: '#FFFFFF', label: t('colorWhite') },
                { color: '#0a0a0a', label: t('colorBlack') },
                { color: '#1F2937', label: t('colorDarkGray') },
                { color: '#F5F1EA', label: t('colorCream') },
                { color: '#FFF7ED', label: t('colorBeige') },
                { color: primaryColor, label: t('colorBrand') },
              ]}
              onChange={(v) => setSf({ ...sf, logoBgColor: v })}
            />
            <HeaderColorRow
              label={t('titleColorLabel')}
              hint={t('titleColorHint')}
              value={sf.titleColor ?? ''}
              defaultLabel={t('colorBlack')}
              defaultColor="#0F172A"
              presets={[
                { color: '#0F172A', label: t('colorBlack') },
                { color: '#FFFFFF', label: t('colorWhite') },
                { color: '#1F2937', label: t('colorDarkGray') },
                { color: '#92400E', label: t('colorBrown') },
                { color: '#9F1239', label: t('colorWine') },
                { color: primaryColor, label: t('colorBrand') },
              ]}
              onChange={(v) => setSf({ ...sf, titleColor: v })}
            />
            <HeaderColorRow
              label={t('descriptionColorLabel')}
              hint={t('descriptionColorHint')}
              value={sf.descriptionColor ?? ''}
              defaultLabel={t('colorMediumGray')}
              defaultColor="#64748B"
              presets={[
                { color: '#64748B', label: t('colorMediumGray') },
                { color: '#FFFFFFCC', label: t('colorWhite80') },
                { color: '#0F172A', label: t('colorBlack') },
                { color: '#A78BFA', label: t('colorSoftViolet') },
                { color: '#FBBF24', label: t('colorGold') },
                { color: primaryColor, label: t('colorBrand') },
              ]}
              onChange={(v) => setSf({ ...sf, descriptionColor: v })}
            />
          </div>

          {/* Solo aparece para SECTIONS — es el único layout que muestra
              el botón "Volver" sobre la portada de cada sección. Para los
              demás layouts no hay botón a personalizar. */}
          {(sf.menuLayout ?? 'CLASSIC') === 'SECTIONS' && (
            <>
              <h3 className="text-base font-semibold mt-6 mb-3">
                ← {t('backButtonHeading')}
              </h3>
              <p className="text-mute text-xs mb-3 leading-relaxed">
                {t('backButtonHint')}
              </p>
              <BackButtonEditor
                config={sf.backButtonConfig ?? null}
                onChange={(c) => setSf({ ...sf, backButtonConfig: c })}
              />
            </>
          )}

          <h3 className="text-base font-semibold mt-6 mb-3">🎨 {t('primaryColor')}</h3>
          <p className="text-mute text-xs mb-3 leading-relaxed">
            {t('primaryColorHint', { label: mainLabel, labelLower: mainLabel.toLowerCase() })}
          </p>
          <PrimaryColorPicker
            value={primaryColor}
            onChange={(v) => {
              setPrimaryColor(v);
              setTenantDirty(true);
            }}
          />

          <h3 className="text-base font-semibold mt-6 mb-3">💬 {t('whatsappButton')}</h3>
          <p className="text-mute text-xs mb-3 leading-relaxed">
            {t('whatsappButtonHint', { label: mainLabel.toLowerCase() })}
          </p>
          <WhatsAppConfig
            enabled={sf.whatsappButtonEnabled ?? true}
            phone={whatsappPhone}
            onToggle={(v) =>
              setSf({ ...sf, whatsappButtonEnabled: v })
            }
            onPhoneChange={(v) => {
              setWhatsappPhone(v);
              setTenantDirty(true);
            }}
          />

          <h3 className="text-base font-semibold mt-6 mb-3">
            {t('instagramButton')}
          </h3>
          <p className="text-mute text-xs mb-3 leading-relaxed">
            {t('instagramButtonHint', { label: mainLabel.toLowerCase() })}
          </p>
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={sf.instagramButtonEnabled ?? true}
              onChange={(e) =>
                setSf({ ...sf, instagramButtonEnabled: e.target.checked })
              }
            />
            {t('instagramButtonEnable')}
          </label>

          <h3 className="text-base font-semibold mt-6 mb-3">📣 {t('popupHeading')}</h3>
          <p className="text-mute text-xs mb-3 leading-relaxed">
            {t('popupHint', { label: mainLabel.toLowerCase() })}
          </p>
          <PopupConfig
            enabled={sf.popupEnabled ?? false}
            imageUrl={sf.popupImageUrl ?? null}
            cardId={sf.popupCardId ?? null}
            delaySeconds={sf.popupDelaySeconds ?? 10}
            onChange={(patch) => setSf({ ...sf, ...patch })}
          />

          {/* #5 (2026-06-17): popups múltiples + programados (theme.menuPopups). */}
          <MenuPopupsCard
            popups={(sf.theme?.menuPopups as StorefrontPopupItem[]) ?? []}
            onChange={(arr) =>
              setSf({ ...sf, theme: { ...(sf.theme ?? {}), menuPopups: arr } })
            }
          />

          <h3 className="text-base font-semibold mt-6 mb-4">{t('siteBlocks')}</h3>
          <p className="text-mute text-xs mb-3">
            {t('siteBlocksHint')}
          </p>
          <BlocksList
            blocks={sf.blocks ?? []}
            onChange={(arr) => setSf({ ...sf, blocks: arr })}
          />
          <div className="mt-3">
            <select
              className="input"
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                setSf({
                  ...sf,
                  blocks: [...(sf.blocks ?? []), { type: e.target.value }],
                });
                e.target.value = '';
              }}
            >
              <option value="">{t('addBlock')}</option>
              <option value="hero">Hero</option>
              <option value="social">{t('blockSocial')}</option>
              <option value="menu">{t('blockMenu')}</option>
              <option value="promotions">{t('blockPromotions')}</option>
            </select>
          </div>
        </div>

        <StorefrontPreview
          publicHref={publicHref}
          publicUrl={publicUrl}
          tenantSlug={tenantSlug}
          brandName={brandName}
          description={sf.description}
          blocksCount={sf.blocks?.length ?? 0}
          savedAt={savedAt}
          mainLabel={mainLabel}
          menuLayout={sf.menuLayout ?? 'CLASSIC'}
        />
      </div>
    </div>
  );
}

// =====================================================
// Sortable list of storefront blocks (drag & drop)
// =====================================================

const BLOCK_LABEL: Record<string, { name: string; desc: string; emoji: string }> = {
  hero: { name: 'Hero', desc: 'Logo + nombre + descripción', emoji: '🎯' },
  social: { name: 'Botones sociales', desc: 'WhatsApp / Instagram / Maps', emoji: '🔗' },
  menu: { name: 'Menú', desc: 'Catálogo de productos', emoji: '🍴' },
  cards: { name: 'Tarjetas', desc: 'Tarjetas de fidelización', emoji: '💳' },
  promotions: { name: 'Promociones', desc: 'Promociones activas', emoji: '🎁' },
};

function BlocksList({
  blocks,
  onChange,
}: {
  blocks: any[];
  onChange: (arr: any[]) => void;
}) {
  const t = useTranslations('app_storefront');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  // Build stable IDs per index to allow duplicates by type
  const items = blocks.map((b, i) => ({ id: `${b.type}__${i}`, block: b, index: i }));

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((x) => x.id === active.id);
    const newIndex = items.findIndex((x) => x.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onChange(arrayMove(blocks, oldIndex, newIndex));
  }

  if (items.length === 0) {
    return (
      <div className="text-xs text-mute italic px-3 py-4 border border-dashed border-line rounded-lg text-center">
        {t('noBlocks')}
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {items.map((it) => (
            <SortableBlock
              key={it.id}
              id={it.id}
              block={it.block}
              onRemove={() => {
                const arr = [...blocks];
                arr.splice(it.index, 1);
                onChange(arr);
              }}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableBlock({
  id,
  block,
  onRemove,
}: {
  id: string;
  block: any;
  onRemove: () => void;
}) {
  const t = useTranslations('app_storefront');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const meta = BLOCK_LABEL[block.type] ?? {
    name: block.type,
    desc: '',
    emoji: '🧱',
  };
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`border ${isDragging ? 'border-brand shadow-lg' : 'border-line2'} rounded-lg p-3 flex items-center gap-3 bg-white`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-mute hover:text-ink"
        aria-label={t('moveBlock')}
        type="button"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="5" cy="3" r="1.5" />
          <circle cx="11" cy="3" r="1.5" />
          <circle cx="5" cy="8" r="1.5" />
          <circle cx="11" cy="8" r="1.5" />
          <circle cx="5" cy="13" r="1.5" />
          <circle cx="11" cy="13" r="1.5" />
        </svg>
      </button>
      <div className="text-lg" aria-hidden>
        {meta.emoji}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{meta.name}</div>
        <div className="text-xs text-mute truncate">{meta.desc}</div>
      </div>
      <button
        type="button"
        className="text-bad text-xs hover:underline"
        onClick={onRemove}
      >
        {t('remove')}
      </button>
    </div>
  );
}

// =====================================================
// Vista previa: simulación rápida + iframe live
// =====================================================
function StorefrontPreview({
  publicHref,
  publicUrl,
  tenantSlug,
  brandName,
  description,
  blocksCount,
  savedAt,
  mainLabel,
  menuLayout,
}: {
  publicHref: string;
  publicUrl: string;
  tenantSlug: string;
  brandName: string;
  description: string;
  blocksCount: number;
  savedAt: Date | null;
  mainLabel: string;
  menuLayout: MenuLayout;
}) {
  const t = useTranslations('app_storefront');
  // Default a 'live' cuando el negocio ya tiene slug: es el único modo
  // que refleja el layout real (premium / SECTIONS / colores de header).
  // El SimPreview es un mock genérico estilo CLASSIC y se queda como
  // fallback informativo si el slug aún no existe.
  const [mode, setMode] = useState<'sim' | 'live'>(
    tenantSlug ? 'live' : 'sim',
  );
  const [iframeKey, setIframeKey] = useState(0);

  // Recarga el iframe cada vez que se publica (savedAt cambia).
  useEffect(() => {
    if (mode === 'live' && savedAt) setIframeKey((k) => k + 1);
  }, [savedAt, mode]);

  // Si el layout activo no es CLASSIC, la simulación no lo refleja.
  // Mostramos un aviso para evitar que el user crea que su menú se ve
  // así en producción.
  const simIsFaithful = menuLayout === 'CLASSIC';
  const layoutLabel = (
    MENU_LAYOUTS.find((l) => l.id === menuLayout)?.label ?? menuLayout
  );

  // Hora "viva" para que el iPhone se sienta real
  const [now, setNow] = useState<string>('11:42');
  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleTimeString('es-CO', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      );
    tick();
    const t = setInterval(tick, 30 * 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="lg:sticky lg:top-4">
      <div className="flex items-center justify-between mb-3 px-2">
        <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold">
          {t('preview')}
        </div>
        <div className="flex gap-0.5 bg-bg2 rounded-pill p-0.5 text-xs">
          <button
            onClick={() => setMode('sim')}
            className={`px-3 py-1 rounded-pill font-medium ${
              mode === 'sim' ? 'bg-white text-ink shadow-sm' : 'text-mute'
            }`}
          >
            {t('simulation')}
          </button>
          <button
            onClick={() => setMode('live')}
            disabled={!tenantSlug}
            className={`px-3 py-1 rounded-pill font-medium disabled:opacity-50 ${
              mode === 'live' ? 'bg-white text-ink shadow-sm' : 'text-mute'
            }`}
          >
            {t('live')}
          </button>
        </div>
      </div>

      <div className="flex justify-center">
        {/* iPhone real — frame negro grueso + notch dinámico + altura realista */}
        <div className="relative w-[320px] h-[640px] bg-[#0a0a0a] rounded-[44px] p-[10px] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45),0_0_0_1.5px_#1f1f1f,0_0_0_3px_#000]">
          {/* Notch dinámico */}
          <div className="absolute top-[10px] left-1/2 -translate-x-1/2 w-[110px] h-[28px] bg-black rounded-b-[18px] z-20 flex items-center justify-end pr-3">
            <div className="w-2 h-2 rounded-full bg-zinc-800 mr-2" />
          </div>
          {/* Botones laterales */}
          <div className="absolute -left-[3px] top-[110px] w-[3px] h-[30px] bg-[#0a0a0a] rounded-l" />
          <div className="absolute -left-[3px] top-[160px] w-[3px] h-[55px] bg-[#0a0a0a] rounded-l" />
          <div className="absolute -left-[3px] top-[230px] w-[3px] h-[55px] bg-[#0a0a0a] rounded-l" />
          <div className="absolute -right-[3px] top-[180px] w-[3px] h-[80px] bg-[#0a0a0a] rounded-r" />

          <div className="w-full h-full bg-white rounded-[36px] overflow-hidden relative">
            {/* Status bar */}
            <div className="absolute top-0 left-0 right-0 h-[34px] z-10 flex items-center justify-between px-7 text-[12px] font-semibold text-ink pointer-events-none">
              <span>{now}</span>
              <span className="flex items-center gap-1">
                {/* Señal */}
                <svg width="16" height="10" viewBox="0 0 16 10" fill="currentColor">
                  <rect x="0" y="6" width="3" height="4" rx="0.5" />
                  <rect x="4.5" y="4" width="3" height="6" rx="0.5" />
                  <rect x="9" y="2" width="3" height="8" rx="0.5" />
                  <rect x="13.5" y="0" width="3" height="10" rx="0.5" opacity="0.4" />
                </svg>
                {/* WiFi */}
                <svg width="14" height="10" viewBox="0 0 14 10" fill="currentColor">
                  <path d="M7 8a1.4 1.4 0 100 2.8A1.4 1.4 0 007 8zm-2.7-2.5a3.8 3.8 0 015.4 0l1-1a5.2 5.2 0 00-7.4 0l1 1zm-2.5-2.5a7.4 7.4 0 0110.4 0l1-1a8.8 8.8 0 00-12.4 0l1 1z" />
                </svg>
                {/* Batería */}
                <svg width="24" height="11" viewBox="0 0 24 11" fill="none">
                  <rect x="0.5" y="0.5" width="20" height="10" rx="2.5" stroke="currentColor" />
                  <rect x="22" y="3.5" width="1.5" height="4" rx="0.5" fill="currentColor" />
                  <rect x="2" y="2" width="17" height="7" rx="1" fill="currentColor" />
                </svg>
              </span>
            </div>

            <div className="pt-[34px] h-full overflow-hidden">
              {mode === 'sim' ? (
                <div className="h-full overflow-hidden">
                  {!simIsFaithful && (
                    <div className="bg-amber-50 border-b border-amber-200 px-2 py-1.5 text-[9px] text-amber-900 leading-snug text-center">
                      {t.rich('simNotFaithful', {
                        layout: layoutLabel,
                        strong: (chunks) => <strong>{chunks}</strong>,
                      })}
                    </div>
                  )}
                  <SimPreview
                    brandName={brandName}
                    description={description}
                    blocksCount={blocksCount}
                    mainLabel={mainLabel}
                  />
                </div>
              ) : tenantSlug ? (
                <iframe
                  key={iframeKey}
                  src={publicHref}
                  title={t('sitePreviewTitle')}
                  className="w-full border-0 block"
                  style={{ height: 'calc(640px - 34px - 20px)' }}
                />
              ) : (
                <div className="p-6 text-xs text-mute text-center mt-20">
                  {t('cannotPreviewYet')}
                </div>
              )}
            </div>

            {/* Home indicator */}
            <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-[110px] h-[5px] bg-black rounded-full opacity-90" />
          </div>
        </div>
      </div>

      <div className="mt-4 text-center text-xs text-mute flex items-center justify-center gap-2 flex-wrap">
        <code className="bg-bg2 px-2 py-0.5 rounded text-[11px]">{publicUrl || '—'}</code>
        {mode === 'live' && tenantSlug && (
          <button
            onClick={() => setIframeKey((k) => k + 1)}
            className="text-brand hover:underline"
          >
            ↻ {t('refresh')}
          </button>
        )}
      </div>
    </div>
  );
}

function SimPreview({
  brandName,
  description,
  blocksCount,
  mainLabel,
}: {
  brandName: string;
  description: string;
  blocksCount: number;
  mainLabel: string;
}) {
  const t = useTranslations('app_storefront');
  return (
    <div className="h-full overflow-y-auto px-5 pt-3 pb-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 text-white flex items-center justify-center font-bold text-xl shadow">
          {brandName.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-base leading-tight truncate">{brandName}</div>
          <div className="text-[11px] text-mute mt-0.5 line-clamp-2">{description || t('noDescriptionYet')}</div>
        </div>
      </div>
      <div className="flex gap-1.5 mt-3 text-[11px]">
        <span className="px-2 py-1 rounded-full bg-[#25D366]/10 text-[#1da856] font-semibold">📞 WhatsApp</span>
        <span className="px-2 py-1 rounded-full bg-bg2 text-mute">📷 IG</span>
        <span className="px-2 py-1 rounded-full bg-bg2 text-mute">📍 Maps</span>
      </div>
      <div className="flex gap-1.5 mt-3 text-[11px]">
        <span className="px-2.5 py-1 rounded-full bg-brand text-white font-semibold">{mainLabel}</span>
        <span className="px-2.5 py-1 rounded-full bg-bg2 text-mute">{t('myCard')}</span>
        <span className="px-2.5 py-1 rounded-full bg-bg2 text-mute">{t('promos')}</span>
      </div>

      <div className="mt-4 space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-2 bg-bg2/40 rounded-xl p-2">
            <div className="w-14 h-14 rounded-lg bg-bg2 flex items-center justify-center text-xl">🍽</div>
            <div className="flex-1 min-w-0">
              <div className="h-2 bg-bg2 rounded w-3/4" />
              <div className="h-2 bg-bg2/70 rounded w-full mt-1.5" />
              <div className="h-2 bg-bg2/70 rounded w-1/2 mt-1" />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 text-center text-mute text-[10px] uppercase tracking-wider">
        {t('simSummary', { count: blocksCount })}
      </div>
    </div>
  );
}

// =============================================================
//                Popup config (imagen + tarjeta)
// =============================================================

function PopupConfig({
  enabled,
  imageUrl,
  cardId,
  delaySeconds,
  onChange,
}: {
  enabled: boolean;
  imageUrl: string | null;
  cardId: string | null;
  delaySeconds: number;
  onChange: (patch: {
    popupEnabled?: boolean;
    popupImageUrl?: string | null;
    popupCardId?: string | null;
    popupDelaySeconds?: number;
  }) => void;
}) {
  const t = useTranslations('app_storefront');
  const [cards, setCards] = useState<{ id: string; name: string; isActive: boolean }[]>([]);

  useEffect(() => {
    api<any[]>('/cards')
      .then((arr) =>
        setCards(
          arr
            .filter((c) => c.name && c.name.trim().length > 0)
            .map((c) => ({ id: c.id, name: c.name, isActive: !!c.isActive })),
        ),
      )
      .catch(() => setCards([]));
  }, []);

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
        <input
          type="checkbox"
          className="w-4 h-4"
          checked={enabled}
          onChange={(e) => onChange({ popupEnabled: e.target.checked })}
        />
        {t('popupEnable')}
      </label>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-4">
        <div>
          <label className="label">{t('loyaltyCard')}</label>
          <select
            className="input"
            value={cardId ?? ''}
            onChange={(e) => onChange({ popupCardId: e.target.value || null })}
            disabled={!enabled}
          >
            <option value="">{t('noCardInformational')}</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.isActive}>
                {c.name} {!c.isActive && t('cardPausedSuffix')}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-mute mt-1.5 leading-relaxed">
            {t('popupCardHint')}
          </p>
        </div>

        <div>
          <label className="label">{t('popupImage')}</label>
          <ImageUploader
            value={imageUrl}
            onChange={(url) => onChange({ popupImageUrl: url })}
            folder="storefront-popup"
            crop={false}
          />
          <p className="text-[11px] text-mute mt-1.5">
            {t('popupImageHint')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-4 pt-1">
        <div>
          <label className="label">{t('popupWhenLabel')}</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              className="input w-24"
              min={0}
              max={120}
              step={1}
              value={delaySeconds}
              onChange={(e) => {
                // #6 (2026-06-16): permitir 0 = aparición inmediata. Antes
                // `|| 10` convertía el 0 en 10 y Math.max(1,…) lo bloqueaba.
                const raw = Number(e.target.value);
                const v = Math.max(
                  0,
                  Math.min(120, Number.isFinite(raw) ? raw : 10),
                );
                onChange({ popupDelaySeconds: v });
              }}
              disabled={!enabled}
            />
            <span className="text-sm text-mute">{t('secondsAfterOpen')}</span>
          </div>
          <p className="text-[11px] text-mute mt-1.5 leading-relaxed">
            {t.rich('popupDelayHint', {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
        </div>
      </div>
    </div>
  );
}

// =============================================================
//                Back button editor (SECTIONS layout)
// =============================================================

const BACK_BTN_PRESETS: { label: string; emoji: string; cfg: BackButtonCfg }[] = [
  {
    label: 'Negro translúcido',
    emoji: '◼️',
    cfg: { bgColor: 'rgba(0,0,0,0.4)', iconColor: '#ffffff', shadow: 'md', size: 40 },
  },
  {
    label: 'Blanco translúcido',
    emoji: '⬜',
    cfg: { bgColor: 'rgba(255,255,255,0.85)', iconColor: '#0a0a0a', shadow: 'md', size: 40 },
  },
  {
    label: 'Negro sólido',
    emoji: '⚫',
    cfg: { bgColor: '#0a0a0a', iconColor: '#ffffff', shadow: 'md', size: 40 },
  },
  {
    label: 'Blanco sólido',
    emoji: '⚪',
    cfg: { bgColor: '#ffffff', iconColor: '#0a0a0a', shadow: 'md', size: 40 },
  },
  {
    label: 'Cristal',
    emoji: '💎',
    cfg: {
      bgColor: 'rgba(255,255,255,0.2)',
      iconColor: '#ffffff',
      borderColor: 'rgba(255,255,255,0.6)',
      borderWidth: 1,
      shadow: 'lg',
      size: 40,
    },
  },
];

const DEFAULT_BACK_CFG: Required<BackButtonCfg> = {
  bgColor: 'rgba(0,0,0,0.4)',
  iconColor: '#ffffff',
  opacity: 1,
  borderColor: 'transparent',
  borderWidth: 0,
  shadow: 'md',
  size: 40,
};

function BackButtonEditor({
  config,
  onChange,
}: {
  config: BackButtonCfg | null;
  onChange: (c: BackButtonCfg | null) => void;
}) {
  const t = useTranslations('app_storefront');
  // Merge con defaults para tener valores siempre definidos en los inputs
  const cfg: Required<BackButtonCfg> = {
    ...DEFAULT_BACK_CFG,
    ...(config ?? {}),
  };

  function patch(part: Partial<BackButtonCfg>) {
    onChange({ ...cfg, ...part });
  }

  // Vista previa: rect oscuro de fondo + el botón como se vería real
  const shadowMap: Record<string, string> = {
    none: 'none',
    sm: '0 1px 2px rgba(0,0,0,0.1)',
    md: '0 4px 6px -1px rgba(0,0,0,0.1)',
    lg: '0 10px 15px -3px rgba(0,0,0,0.1)',
  };

  return (
    <div className="space-y-3">
      {/* Presets rápidos */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-mute font-semibold mb-1.5">
          {t('quickStyles')}
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {BACK_BTN_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(p.cfg)}
              className="flex flex-col items-center gap-1 px-1 py-2 rounded-lg border-2 border-line hover:border-brand text-[10px] transition"
              title={p.label}
            >
              <span className="text-base">{p.emoji}</span>
              <span className="leading-tight text-center">{p.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Vista previa: simulamos una portada con foto + el botón encima */}
      <div className="relative h-32 rounded-xl overflow-hidden border border-line">
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(135deg, #6366F1 0%, #EC4899 50%, #F59E0B 100%)',
          }}
        />
        <button
          type="button"
          className="absolute top-3 left-3 rounded-full backdrop-blur-md flex items-center justify-center transition-all hover:opacity-90"
          style={{
            width: cfg.size,
            height: cfg.size,
            background: cfg.bgColor,
            color: cfg.iconColor,
            opacity: cfg.opacity,
            border: cfg.borderWidth
              ? `${cfg.borderWidth}px solid ${cfg.borderColor}`
              : undefined,
            boxShadow: shadowMap[cfg.shadow] ?? shadowMap.md,
            fontSize: Math.round(cfg.size * 0.5),
          }}
          aria-label={t('backButtonPreviewAria')}
        >
          ←
        </button>
        <span className="absolute bottom-2 right-3 text-[10px] text-white/80 uppercase tracking-wider font-semibold">
          {t('preview')}
        </span>
      </div>

      {/* Controles individuales */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label text-[11px]">{t('bgColor')}</label>
          <input
            type="text"
            className="input font-mono text-xs"
            value={cfg.bgColor}
            onChange={(e) => patch({ bgColor: e.target.value })}
            placeholder="rgba(0,0,0,0.4)"
            spellCheck={false}
          />
        </div>
        <div>
          <label className="label text-[11px]">{t('arrowColor')}</label>
          <input
            type="text"
            className="input font-mono text-xs"
            value={cfg.iconColor}
            onChange={(e) => patch({ iconColor: e.target.value })}
            placeholder="#ffffff"
            spellCheck={false}
          />
        </div>
      </div>

      <div>
        <div className="flex justify-between text-[11px] mb-0.5">
          <span className="uppercase tracking-wider text-mute font-semibold">
            {t('opacity')}
          </span>
          <span className="text-mute">{Math.round(cfg.opacity * 100)}%</span>
        </div>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={cfg.opacity}
          onChange={(e) => patch({ opacity: Number(e.target.value) })}
          className="w-full accent-brand"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label text-[11px]">{t('sizePx')}</label>
          <input
            type="number"
            className="input"
            min={24}
            max={80}
            step={2}
            value={cfg.size}
            onChange={(e) => {
              const v = Math.max(24, Math.min(80, Number(e.target.value) || 40));
              patch({ size: v });
            }}
          />
        </div>
        <div>
          <label className="label text-[11px]">{t('shadow')}</label>
          <select
            className="input"
            value={cfg.shadow}
            onChange={(e) => patch({ shadow: e.target.value as any })}
          >
            <option value="none">{t('shadowNone')}</option>
            <option value="sm">{t('shadowSoft')}</option>
            <option value="md">{t('shadowMedium')}</option>
            <option value="lg">{t('shadowStrong')}</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label text-[11px]">{t('borderColor')}</label>
          <input
            type="text"
            className="input font-mono text-xs"
            value={cfg.borderColor}
            onChange={(e) => patch({ borderColor: e.target.value })}
            placeholder="transparent"
            spellCheck={false}
          />
        </div>
        <div>
          <label className="label text-[11px]">{t('borderWidth')}</label>
          <input
            type="number"
            className="input"
            min={0}
            max={6}
            step={1}
            value={cfg.borderWidth}
            onChange={(e) => {
              const v = Math.max(0, Math.min(6, Number(e.target.value) || 0));
              patch({ borderWidth: v });
            }}
          />
        </div>
      </div>

      {config && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-xs text-mute hover:text-brand underline"
        >
          ↺ {t('resetToDefault')}
        </button>
      )}
    </div>
  );
}

// =============================================================
//                Page background color picker
// =============================================================

/** Selector del color de fondo de la página pública. value vacío = usar
 *  default del layout. Ofrece swatches con los defaults conocidos +
 *  selector libre + botón "usar default" para limpiar. */
/**
 * Editor con tabs para 3 tipos de fondo de la página pública:
 *   SOLID    → un color (delega a PageBgColorPicker existente)
 *   GRADIENT → 2 colores + dirección (genera linear-gradient CSS)
 *   IMAGE    → URL de imagen (ImageUploader → R2)
 * Incluye un preview grande del fondo final aplicado al final.
 */
type PageBgType = 'SOLID' | 'GRADIENT' | 'IMAGE';

function PageBackgroundEditor({
  type,
  color,
  gradient,
  imageUrl,
  isCluvi,
  onChange,
}: {
  type: PageBgType;
  color: string;
  gradient: string;
  imageUrl: string;
  isCluvi: boolean;
  onChange: (patch: {
    pageBackgroundType?: string | null;
    pageBackgroundColor?: string | null;
    pageBackgroundGradient?: string | null;
    pageBackgroundImageUrl?: string | null;
  }) => void;
}) {
  const t = useTranslations('app_storefront');
  // Parseamos el gradient para mostrar el editor amigable. Si el user
  // pegó algo manual que no matchea nuestro patrón, mostramos sólo el
  // input raw. Patrón soportado: linear-gradient(<deg>deg, <c1>, <c2>).
  const parsed = parseGradient(gradient);
  const [c1, setC1] = useState(parsed?.c1 ?? '#6366F1');
  const [c2, setC2] = useState(parsed?.c2 ?? '#EC4899');
  const [deg, setDeg] = useState<number>(parsed?.deg ?? 135);

  // Cuando el user edita los 2 colores + dirección, regeneramos el
  // gradient y lo guardamos. Esto es controlled — el render del preview
  // refleja el cambio inmediatamente sin save.
  function applyGradient(nextC1: string, nextC2: string, nextDeg: number) {
    setC1(nextC1);
    setC2(nextC2);
    setDeg(nextDeg);
    const next = `linear-gradient(${nextDeg}deg, ${nextC1}, ${nextC2})`;
    onChange({ pageBackgroundGradient: next });
  }

  const defaultBg = isCluvi ? '#0a0a0a' : '#FAFBFC';
  // CSS final aplicado en preview — matchea exactamente la lógica del
  // viewer (storefront-client.tsx).
  let previewCss = color || defaultBg;
  if (type === 'GRADIENT' && gradient) previewCss = gradient;
  if (type === 'IMAGE' && imageUrl)
    previewCss = `url("${imageUrl}") center/cover no-repeat ${defaultBg}`;

  const TABS: { id: PageBgType; label: string; icon: string }[] = [
    { id: 'SOLID', label: t('tabColor'), icon: '🎨' },
    { id: 'GRADIENT', label: t('tabGradient'), icon: '🌈' },
    { id: 'IMAGE', label: t('tabImage'), icon: '🖼️' },
  ];

  // Presets de gradientes para arranque rápido.
  const GRADIENT_PRESETS = [
    { c1: '#6366F1', c2: '#EC4899', deg: 135, label: t('gradVioletPink') },
    { c1: '#22C55E', c2: '#0EA5E9', deg: 135, label: t('gradGreenSky') },
    { c1: '#F59E0B', c2: '#EF4444', deg: 135, label: t('gradOrangeRed') },
    { c1: '#0F172A', c2: '#475569', deg: 180, label: t('gradDarkNight') },
    { c1: '#FCD34D', c2: '#FB923C', deg: 135, label: t('gradSunset') },
    { c1: '#A78BFA', c2: '#FBCFE8', deg: 135, label: t('gradSoftPastel') },
  ];

  return (
    <div className="space-y-3">
      {/* Tabs */}
      <div className="flex gap-1.5 p-1 bg-bg2 rounded-lg">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange({ pageBackgroundType: tab.id })}
            className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition ${
              type === tab.id
                ? 'bg-white shadow-sm text-ink'
                : 'text-mute hover:text-ink'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Editor por tipo */}
      {type === 'SOLID' && (
        <PageBgColorPicker
          value={color}
          isCluvi={isCluvi}
          onChange={(v) => onChange({ pageBackgroundColor: v })}
        />
      )}

      {type === 'GRADIENT' && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">{t('color1')}</label>
              <input
                type="color"
                className="w-full h-11 rounded-lg border border-line cursor-pointer"
                value={c1}
                onChange={(e) => applyGradient(e.target.value, c2, deg)}
              />
            </div>
            <div>
              <label className="label">{t('color2')}</label>
              <input
                type="color"
                className="w-full h-11 rounded-lg border border-line cursor-pointer"
                value={c2}
                onChange={(e) => applyGradient(c1, e.target.value, deg)}
              />
            </div>
            <div>
              <label className="label">{t('angle', { deg })}</label>
              <input
                type="range"
                min={0}
                max={360}
                step={5}
                value={deg}
                onChange={(e) =>
                  applyGradient(c1, c2, Number(e.target.value))
                }
                className="w-full mt-2"
              />
            </div>
          </div>
          <div className="flex gap-1.5 flex-wrap items-center">
            <span className="text-[10px] uppercase tracking-wider text-mute font-semibold mr-1">
              {t('presets')}
            </span>
            {GRADIENT_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyGradient(p.c1, p.c2, p.deg)}
                className="w-12 h-7 rounded-md border-2 border-white hover:scale-105 transition"
                style={{
                  background: `linear-gradient(${p.deg}deg, ${p.c1}, ${p.c2})`,
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.1)',
                }}
                title={p.label}
              />
            ))}
          </div>
        </div>
      )}

      {type === 'IMAGE' && (
        <div className="space-y-2">
          <ImageUploader
            value={imageUrl || null}
            onChange={(url) =>
              onChange({ pageBackgroundImageUrl: url ?? null })
            }
            folder="storefront-bg"
          />
          <p className="text-[11px] text-mute leading-snug">
            {t('bgImageHint')}
          </p>
        </div>
      )}

      {/* Preview en tiempo real */}
      <div>
        <label className="label">{t('preview')}</label>
        <div
          className="rounded-xl border border-line h-24 w-full"
          style={{ background: previewCss }}
        />
      </div>
    </div>
  );
}

// Parsea linear-gradient(<deg>deg, <c1>, <c2>) → { c1, c2, deg }. Si no
// matchea (gradient custom pegado por el user), devuelve null.
function parseGradient(
  gradient: string,
): { c1: string; c2: string; deg: number } | null {
  if (!gradient) return null;
  const m = gradient.match(
    /^linear-gradient\(\s*(\d+)deg\s*,\s*([^,]+),\s*([^)]+)\)$/i,
  );
  if (!m) return null;
  return {
    deg: Number(m[1]),
    c1: m[2].trim(),
    c2: m[3].trim(),
  };
}

function PageBgColorPicker({
  value,
  isCluvi,
  onChange,
}: {
  value: string;
  isCluvi: boolean;
  onChange: (v: string | null) => void;
}) {
  const t = useTranslations('app_storefront');
  const isUsingDefault = !value;
  const defaultBg = isCluvi ? '#0a0a0a' : '#FAFBFC';
  const effective = value || defaultBg;

  // Presets pensados para SECTIONS premium — fondos suaves que no
  // compiten con los banners de cada categoría.
  const PRESETS = [
    { color: '#FAFBFC', label: t('bgLightGrayDefault') },
    { color: '#FFFFFF', label: t('bgPureWhite') },
    { color: '#F5F1EA', label: t('colorCream') },
    { color: '#FFF7ED', label: t('bgWarmBeige') },
    { color: '#F0F9FF', label: t('bgSoftSky') },
    { color: '#F0FDF4', label: t('bgMintGreen') },
    { color: '#FDF2F8', label: t('bgPalePink') },
    { color: '#1F2937', label: t('colorDarkGray') },
    { color: '#0a0a0a', label: t('colorBlack') },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={effective}
          onChange={(e) => onChange(e.target.value)}
          className="w-12 h-12 rounded-lg border border-line cursor-pointer"
          aria-label={t('bgColorSelectorAria')}
        />
        <div className="flex-1">
          <label className="label">{t('hexCode')}</label>
          <input
            type="text"
            className="input font-mono uppercase"
            value={value}
            placeholder={t('defaultPlaceholder', { value: defaultBg })}
            onChange={(e) => {
              const v = e.target.value.trim();
              if (!v) {
                onChange(null);
                return;
              }
              const m = v.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
              if (m) {
                let hex = m[1];
                if (hex.length === 3)
                  hex = hex
                    .split('')
                    .map((c) => c + c)
                    .join('');
                onChange('#' + hex.toLowerCase());
              } else {
                // Permitir cualquier color CSS no-hex (rgb, nombre)
                onChange(v);
              }
            }}
            maxLength={40}
          />
        </div>
        <div
          className="w-12 h-12 rounded-lg border border-line"
          style={{ background: effective }}
          title={t('previewValue', { value: effective })}
        />
      </div>
      <div className="flex gap-1.5 flex-wrap items-center">
        <span className="text-[10px] uppercase tracking-wider text-mute font-semibold mr-1">
          {t('suggested')}
        </span>
        {PRESETS.map((p) => (
          <button
            key={p.color}
            type="button"
            onClick={() => onChange(p.color)}
            className={`w-7 h-7 rounded-md border-2 transition ${
              value.toLowerCase() === p.color.toLowerCase()
                ? 'border-ink scale-110'
                : 'border-white hover:scale-105'
            }`}
            style={{
              background: p.color,
              boxShadow: '0 0 0 1px rgba(0,0,0,0.1)',
            }}
            title={p.label}
            aria-label={p.label}
          />
        ))}
      </div>
      {!isUsingDefault && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-xs text-mute hover:text-brand underline"
        >
          ↺ {t('useLayoutDefault', { value: defaultBg })}
        </button>
      )}
    </div>
  );
}

// =============================================================
//                Header color row (logo bg / título / descripción)
// =============================================================

/** Picker compacto en una fila: swatch | label+hex | presets. Pensado
 *  para listas verticales de configs de color donde cada item ocupa poco
 *  espacio. allowTransparent agrega un swatch checker que setea el valor
 *  literal "transparent" (CSS válido). */
function HeaderColorRow({
  label,
  hint,
  value,
  defaultLabel,
  defaultColor,
  presets,
  allowTransparent,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  defaultLabel: string;
  defaultColor: string;
  presets: { color: string; label: string }[];
  allowTransparent?: boolean;
  onChange: (v: string | null) => void;
}) {
  const t = useTranslations('app_storefront');
  const isUsingDefault = !value;
  const isTransparent = value === 'transparent';
  // input type=color no acepta "transparent" — caemos al default visual.
  const effective = isTransparent ? defaultColor : value || defaultColor;

  return (
    <div className="border border-line rounded-lg p-3 space-y-2 bg-bg2/30">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{label}</div>
          {hint && <div className="text-[11px] text-mute leading-snug">{hint}</div>}
        </div>
        {!isUsingDefault && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[10px] text-mute hover:text-brand underline whitespace-nowrap"
          >
            ↺ {t('defaultWith', { label: defaultLabel })}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={effective}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-10 rounded-md border border-line cursor-pointer flex-none"
          aria-label={t('selectorFor', { label })}
        />
        <input
          type="text"
          className="input font-mono uppercase text-xs flex-1"
          value={value}
          placeholder={t('defaultPlaceholder', { value: defaultColor })}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (!v) {
              onChange(null);
              return;
            }
            const m = v.match(/^#?([0-9a-fA-F]{3,8})$/);
            if (m) {
              onChange('#' + m[1].toLowerCase());
            } else {
              onChange(v);
            }
          }}
          maxLength={40}
        />
        <div
          className="w-10 h-10 rounded-md border border-line flex-none"
          style={
            isTransparent
              ? {
                  backgroundImage:
                    'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)',
                  backgroundSize: '8px 8px',
                  backgroundPosition: '0 0, 4px 4px',
                }
              : { background: effective }
          }
          title={isTransparent ? t('transparent') : effective}
        />
      </div>
      <div className="flex gap-1 flex-wrap">
        {allowTransparent && (
          <button
            type="button"
            onClick={() => onChange('transparent')}
            className={`w-6 h-6 rounded border-2 transition ${
              isTransparent ? 'border-ink scale-110' : 'border-white hover:scale-105'
            }`}
            style={{
              backgroundImage:
                'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%), linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)',
              backgroundSize: '6px 6px',
              backgroundPosition: '0 0, 3px 3px',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.1)',
            }}
            title={t('transparent')}
            aria-label={t('transparent')}
          />
        )}
        {presets.map((p) => (
          <button
            key={p.color + p.label}
            type="button"
            onClick={() => onChange(p.color)}
            className={`w-6 h-6 rounded border-2 transition ${
              value.toLowerCase() === p.color.toLowerCase()
                ? 'border-ink scale-110'
                : 'border-white hover:scale-105'
            }`}
            style={{
              background: p.color,
              boxShadow: '0 0 0 1px rgba(0,0,0,0.1)',
            }}
            title={p.label}
            aria-label={p.label}
          />
        ))}
      </div>
    </div>
  );
}

// =============================================================
//                Primary color picker
// =============================================================

/** Color picker simple: input nativo type=color + texto HEX editable.
 *  El nativo abre el sistema de color del OS; el HEX permite pegar/escribir
 *  códigos exactos de marca. Valida que el HEX sea válido antes de
 *  notificar onChange para no ensuciar el color del tenant con strings
 *  parciales mientras el cliente tipea. */
function PrimaryColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const t = useTranslations('app_storefront');
  const [hexDraft, setHexDraft] = useState(value);

  useEffect(() => {
    setHexDraft(value);
  }, [value]);

  function commitHex(v: string) {
    const trimmed = v.trim();
    // Acepta #abc, #aabbcc, abc, aabbcc — normalizamos a #aabbcc.
    const m = trimmed.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    if (!m) return;
    let hex = m[1];
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('');
    }
    onChange('#' + hex.toLowerCase());
  }

  const PRESETS = [
    '#22C55E',
    '#0EA5E9',
    '#6366F1',
    '#A855F7',
    '#EC4899',
    '#F59E0B',
    '#EF4444',
    '#0F172A',
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-12 h-12 rounded-lg border border-line cursor-pointer"
          aria-label={t('colorSelectorAria')}
        />
        <div className="flex-1">
          <label className="label">{t('hexCode')}</label>
          <input
            type="text"
            className="input font-mono uppercase"
            value={hexDraft}
            onChange={(e) => setHexDraft(e.target.value)}
            onBlur={(e) => commitHex(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            placeholder="#22C55E"
            maxLength={7}
          />
        </div>
        <div
          className="w-12 h-12 rounded-lg border border-line"
          style={{ background: value }}
          title={t('previewValue', { value })}
        />
      </div>
      <div className="flex gap-1.5 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-mute font-semibold self-center mr-1">
          {t('suggested')}
        </span>
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={`w-6 h-6 rounded-full border-2 transition ${
              value.toLowerCase() === p.toLowerCase()
                ? 'border-ink scale-110'
                : 'border-white hover:scale-105'
            }`}
            style={{ background: p, boxShadow: '0 0 0 1px rgba(0,0,0,0.08)' }}
            title={p}
            aria-label={t('colorAria', { color: p })}
          />
        ))}
      </div>
    </div>
  );
}

// =============================================================
//                WhatsApp config (toggle + country + number)
// =============================================================

function WhatsAppConfig({
  enabled,
  phone,
  onToggle,
  onPhoneChange,
}: {
  enabled: boolean;
  phone: string;
  onToggle: (v: boolean) => void;
  onPhoneChange: (fullPhone: string) => void;
}) {
  const t = useTranslations('app_storefront');
  const { dial, local } = parsePhone(phone);
  const currentCountry =
    COUNTRY_CODES.find((c) => c.dial === dial) ?? COUNTRY_CODES[0];

  function update(nextDial: string, nextLocal: string) {
    const clean = nextLocal.replace(/\D/g, '');
    if (!clean) {
      onPhoneChange('');
      return;
    }
    onPhoneChange(`+${nextDial}${clean}`);
  }

  const finalNumber = phone.replace(/\D/g, '');
  const waLink = finalNumber ? `https://wa.me/${finalNumber}` : null;

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
        <input
          type="checkbox"
          className="w-4 h-4"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        {t('whatsappShowButton')}
      </label>

      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <div>
          <label className="label">{t('country')}</label>
          <select
            className="input"
            value={currentCountry.code}
            onChange={(e) => {
              const next = COUNTRY_CODES.find((c) => c.code === e.target.value);
              if (!next) return;
              update(next.dial, local);
            }}
          >
            {COUNTRY_CODES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.flag} {c.name} +{c.dial}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t('number')}</label>
          <input
            type="tel"
            inputMode="numeric"
            className="input"
            value={local}
            onChange={(e) => update(currentCountry.dial, e.target.value)}
            placeholder={t('digitsPlaceholder', { count: currentCountry.maxLen })}
            maxLength={currentCountry.maxLen + 4}
          />
        </div>
      </div>

      {/* Vista previa del número final + link wa.me. Se actualiza en
          tiempo real y le confirma al cliente cómo va a quedar. */}
      <div className="text-[11px] text-mute leading-relaxed">
        {finalNumber ? (
          <>
            {t('finalRedirect')}{' '}
            <span className="font-mono text-ink">
              +{currentCountry.dial} {local}
            </span>
            {waLink && (
              <>
                {' · '}
                <a
                  href={waLink}
                  target="_blank"
                  className="text-brand underline"
                >
                  {t('testLink')}
                </a>
              </>
            )}
          </>
        ) : (
          t('enterNumberToPreview')
        )}
        {local && local.length < currentCountry.maxLen && (
          <div className="text-amber-700 mt-1">
            ⚠️ {t('digitsWarning', {
              country: currentCountry.name,
              expected: currentCountry.maxLen,
              missing: currentCountry.maxLen - local.length,
            })}
          </div>
        )}
      </div>
    </div>
  );
}

'use client';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { EmojiPicker } from '@/components/EmojiPicker';
import { PhoneInput } from '@/components/PhoneInput';
import { useTenantCountry, stateExamplePlaceholder } from '@/lib/useTenantCountry';
import type { MapPickResult } from '@/components/MapPicker';

// Leaflet usa `window` al importar — dynamic import sin SSR
const MapPicker = dynamic(
  () => import('@/components/MapPicker').then((m) => m.MapPicker),
  { ssr: false, loading: () => <div className="h-[440px] rounded-input bg-bg2 animate-shimmer" /> },
);

type Suggestion = {
  name: string;
  street?: string;
  housenumber?: string;
  city?: string;
  state?: string;
  country?: string;
  lat: number;
  lon: number;
  /** Tipo OSM: house, street, locality, etc. */
  osm_value?: string;
};

export default function LocationsPage() {
  const t = useTranslations('app_locations');
  const country = useTenantCountry();
  const [list, setList] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: '',
    address: '',
    latitude: 4.6097,
    longitude: -74.0817,
    radiusMeters: 300,
    walletRelevantText: '',
    mapsUrl: '',
    adminName: '',
    adminPhone: '',
    state: '',
    ordersWhatsappPhone: '',
  });
  const [picked, setPicked] = useState<MapPickResult | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handlePick = useCallback((r: MapPickResult) => {
    setPicked(r);
    setForm((f) => ({
      ...f,
      latitude: r.lat,
      longitude: r.lng,
      address: r.address,
      name: f.name || r.name || r.address.split(',')[0] || 'Local',
    }));
  }, []);

  async function load() {
    try {
      setList(await api('/locations'));
    } catch (e: any) {
      toast(e.message || t('errorLoading'), 'error');
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!picked) {
      setErr(t('errSearchFirst'));
      return;
    }
    try {
      await api('/locations', { method: 'POST', body: JSON.stringify(form) });
      setForm({
        name: '',
        address: '',
        latitude: 4.6097,
        longitude: -74.0817,
        radiusMeters: 300,
        walletRelevantText: '',
        mapsUrl: '',
        adminName: '',
        adminPhone: '',
        state: '',
        ordersWhatsappPhone: '',
      });
      setPicked(null);
      load();
      toast(t('toastAdded'), 'success');
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function remove(id: string) {
    if (!confirm(t('confirmRemove'))) return;
    try {
      await api(`/locations/${id}`, { method: 'DELETE' });
      load();
      toast(t('toastRemoved'), 'success');
    } catch (e: any) {
      toast(e.message || t('errorCouldNotRemove'), 'error');
    }
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {t('title')}{' '}
          <span className="page-crumb">
            {t('configuredCount', { count: list.length })}
          </span>
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <form onSubmit={create} className="card card-pad">
          <h2 className="text-base font-semibold m-0">{t('newLocation')}</h2>

          {/* Map picker estilo Google Maps */}
          <div className="mt-4">
            <label className="label">{t('findOnMap')}</label>
            <MapPicker
              picked={picked}
              onPick={handlePick}
              height={400}
            />
          </div>

          {picked && (
            <>
              <div className="mt-3">
                <label className="label">{t('localName')}</label>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </div>
              <div className="mt-3">
                <label className="label">{t('address')}</label>
                <input
                  className="input"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </div>

              <div className="mt-3">
                <label className="label">{t('mapsUrlLabelOptional')}</label>
                <input
                  className="input"
                  value={form.mapsUrl}
                  onChange={(e) => setForm({ ...form, mapsUrl: e.target.value })}
                  placeholder="https://maps.app.goo.gl/…"
                />
                <p className="text-[11px] text-mute mt-1 leading-snug">
                  {t('mapsUrlHint')}
                </p>
              </div>

              {/* #3: administrador de sede — recibe las alertas de reseña
                  negativa de esta sede en vez del administrador general. */}
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('siteAdminOptional')}</label>
                  <input
                    className="input"
                    value={form.adminName}
                    onChange={(e) => setForm({ ...form, adminName: e.target.value })}
                    placeholder={t('namePlaceholder')}
                  />
                </div>
                <div>
                  <label className="label">{t('adminPhone')}</label>
                  <PhoneInput
                    value={form.adminPhone}
                    onChange={(v) => setForm({ ...form, adminPhone: v })}
                    defaultCountry={country}
                  />
                </div>
                <p className="text-[11px] text-mute -mt-1 col-span-2 leading-snug">
                  {t('siteAdminHint')}
                </p>
              </div>

              {/* Sedes por estado — ruteo de pedidos de domicilio */}
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('stateRegionOfSite')}</label>
                  <input
                    className="input"
                    value={form.state}
                    onChange={(e) => setForm({ ...form, state: e.target.value })}
                    placeholder={stateExamplePlaceholder(country)}
                  />
                </div>
                <div>
                  <label className="label">{t('siteOrdersWhatsapp')}</label>
                  <PhoneInput
                    value={form.ordersWhatsappPhone}
                    onChange={(v) => setForm({ ...form, ordersWhatsappPhone: v })}
                    defaultCountry={country}
                  />
                </div>
                <p className="text-[11px] text-mute -mt-1 col-span-2 leading-snug">
                  {t('siteOrdersHint')}
                </p>
              </div>

              {/* Lat/lng manual (avanzado, colapsado) */}
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="text-[11px] text-mute hover:text-ink mt-3"
              >
                {showAdvanced ? '▲' : '▼'} {t('exactCoordinatesAdvanced')}
              </button>
              {showAdvanced && (
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">{t('latitude')}</label>
                    <input
                      type="number"
                      step="0.000001"
                      className="input"
                      value={form.latitude}
                      onChange={(e) =>
                        setForm({ ...form, latitude: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div>
                    <label className="label">{t('longitude')}</label>
                    <input
                      type="number"
                      step="0.000001"
                      className="input"
                      value={form.longitude}
                      onChange={(e) =>
                        setForm({ ...form, longitude: Number(e.target.value) })
                      }
                    />
                  </div>
                </div>
              )}
            </>
          )}

          <div className="mt-3">
            <label className="label">{t('geoRadius')}</label>
            <select
              className="input"
              value={form.radiusMeters}
              onChange={(e) =>
                setForm({ ...form, radiusMeters: Number(e.target.value) })
              }
            >
              <option value={100}>{t('radius100')}</option>
              <option value={300}>{t('radius300Recommended')}</option>
            </select>
            <p className="text-[11px] text-mute mt-1 leading-relaxed">
              {t('geoRadiusHint')}
            </p>
          </div>
          <div className="mt-3">
            <label className="label">{t('walletPushText')}</label>
            <div className="flex items-stretch gap-2">
              <input
                className="input flex-1"
                placeholder={t('walletPushPlaceholder')}
                value={form.walletRelevantText}
                onChange={(e) =>
                  setForm({ ...form, walletRelevantText: e.target.value })
                }
                maxLength={120}
              />
              <EmojiPicker
                onSelect={(emoji) =>
                  setForm((f) => ({
                    ...f,
                    walletRelevantText: (f.walletRelevantText || '') + emoji,
                  }))
                }
                size="sm"
                placeholder={t('addEmoji')}
              />
            </div>
            <p className="text-[11px] text-mute mt-1 leading-relaxed">
              {t('walletPushHint')}
            </p>
          </div>
          {err && (
            <div className="mt-3 rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink">
              {err}
            </div>
          )}
          <button
            className="btn-primary mt-4 w-full justify-center"
            disabled={!picked}
            title={!picked ? t('searchBusinessFirst') : ''}
          >
            <Icon name="plus" /> {t('addLocation')}
          </button>
        </form>

        <div>
          <h2 className="text-base font-semibold m-0 mb-3">{t('yourLocations')}</h2>
          <div className="space-y-2.5">
            {list.length === 0 && (
              <div className="card card-pad text-center py-8">
                <div className="text-3xl mb-1">📍</div>
                <div className="font-semibold text-sm">{t('emptyTitle')}</div>
                <p className="text-xs text-mute mt-1 max-w-md mx-auto">
                  {t('emptyHint')}
                </p>
              </div>
            )}
            {list.map((l) => (
              <LocationCard
                key={l.id}
                loc={l}
                onRemove={() => remove(l.id)}
                onSaved={load}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LocationCard({
  loc,
  onRemove,
  onSaved,
}: {
  loc: any;
  onRemove: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('app_locations');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const lat = Number(loc.latitude);
  const lng = Number(loc.longitude);
  // BBox aproximado para que el zoom sea razonable según el radio (300m → ~0.005°)
  const radius = Number(loc.radiusMeters ?? 300);
  const delta = Math.max(0.003, radius / 100000); // ~degrees
  const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;
  const embedSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
  const externalLink = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;

  return (
    <div className="card overflow-hidden">
      <div className="card-pad flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="avatar w-9 h-9 avatar-3">
            <Icon name="pin" size={16} />
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate">{loc.name}</div>
            <div className="text-xs text-mute truncate">{loc.address}</div>
            <div className="text-xs text-mute mt-0.5">
              {lat.toFixed(4)}, {lng.toFixed(4)} ·{' '}
              {t('radiusMeters', { radius })}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setOpen((v) => !v)}
            className="btn-ghost text-xs"
            title={t('showOnMap')}
          >
            🗺 {open ? t('hideMap') : t('viewMap')}
          </button>
          <button
            onClick={() => setEditing(true)}
            className="btn-ghost text-xs"
            title={t('editTooltip')}
          >
            <Icon name="edit" /> {tc('edit')}
          </button>
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost text-xs"
            title={t('howToGet')}
          >
            🧭 {t('go')}
          </a>
          <button
            className="btn-danger"
            onClick={onRemove}
            title={t('remove')}
          >
            <Icon name="trash" />
          </button>
        </div>
      </div>
      {editing && (
        <EditLocationModal
          loc={loc}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onSaved();
          }}
        />
      )}
      {open && (
        <div className="border-t border-line2">
          <iframe
            src={embedSrc}
            title={t('mapOf', { name: loc.name })}
            className="w-full"
            style={{ height: 280, border: 0 }}
            loading="lazy"
          />
          <div className="px-3 py-2 text-[10px] text-mute text-right border-t border-line2">
            <a
              href={externalLink}
              target="_blank"
              rel="noreferrer"
              className="text-brand hover:underline"
            >
              {t('openInOsm')}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Modal de edición de ubicación / GeoPush ───
function EditLocationModal({
  loc,
  onClose,
  onSaved,
}: {
  loc: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations('app_locations');
  const tc = useTranslations('common');
  const country = useTenantCountry();
  const [form, setForm] = useState({
    name: loc.name ?? '',
    address: loc.address ?? '',
    latitude: Number(loc.latitude),
    longitude: Number(loc.longitude),
    radiusMeters: Number(loc.radiusMeters ?? 300),
    walletRelevantText: loc.walletRelevantText ?? '',
    mapsUrl: loc.mapsUrl ?? '',
    state: loc.state ?? '',
    ordersWhatsappPhone: loc.ordersWhatsappPhone ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      await api(`/locations/${loc.id}`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      });
      toast(t('toastUpdated'), 'success');
      onSaved();
    } catch (e: any) {
      setErr(e.message || tc('error'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={save}
        className="bg-white rounded-2xl shadow-xl max-w-md w-full p-5 space-y-3 max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-base m-0">{t('editLocation')}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-mute hover:text-ink text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div>
          <label className="label">{t('localName')}</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>

        <div>
          <label className="label">{t('address')}</label>
          <input
            className="input"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder={t('addressPlaceholder')}
          />
        </div>

        <div>
          <label className="label">{t('mapsUrlLabel')}</label>
          <input
            className="input"
            value={form.mapsUrl}
            onChange={(e) => setForm({ ...form, mapsUrl: e.target.value })}
            placeholder="https://maps.app.goo.gl/…"
          />
          <p className="text-[11px] text-mute mt-1 leading-snug">
            {t('mapsUrlHintEdit')}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">{t('stateRegion')}</label>
            <input
              className="input"
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
              placeholder={stateExamplePlaceholder(country)}
            />
          </div>
          <div>
            <label className="label">{t('ordersWhatsapp')}</label>
            <PhoneInput
              value={form.ordersWhatsappPhone}
              onChange={(v) => setForm({ ...form, ordersWhatsappPhone: v })}
              defaultCountry={country}
            />
          </div>
          <p className="text-[11px] text-mute -mt-1 col-span-2 leading-snug">
            {t('ordersHintEdit')}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">{t('latitude')}</label>
            <input
              type="number"
              step="0.000001"
              className="input"
              value={form.latitude}
              onChange={(e) =>
                setForm({ ...form, latitude: Number(e.target.value) })
              }
            />
          </div>
          <div>
            <label className="label">{t('longitude')}</label>
            <input
              type="number"
              step="0.000001"
              className="input"
              value={form.longitude}
              onChange={(e) =>
                setForm({ ...form, longitude: Number(e.target.value) })
              }
            />
          </div>
        </div>

        <div>
          <label className="label">{t('geoRadius')}</label>
          <select
            className="input"
            value={form.radiusMeters}
            onChange={(e) =>
              setForm({ ...form, radiusMeters: Number(e.target.value) })
            }
          >
            <option value={100}>{t('radius100')}</option>
            <option value={300}>{t('radius300Recommended')}</option>
          </select>
        </div>

        <div>
          <label className="label">{t('walletPushTextGeoPush')}</label>
          <input
            className="input"
            placeholder={t('walletPushPlaceholder')}
            value={form.walletRelevantText}
            onChange={(e) =>
              setForm({ ...form, walletRelevantText: e.target.value })
            }
            maxLength={120}
          />
          <p className="text-[11px] text-mute mt-1 leading-snug">
            {t('walletPushHintEdit')}
          </p>
        </div>

        {err && (
          <div className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad-ink">
            {err}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button type="submit" className="btn-primary flex-1" disabled={saving}>
            {saving ? tc('saving') : t('saveChanges')}
          </button>
          <button type="button" onClick={onClose} className="btn-ghost">
            {tc('cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}

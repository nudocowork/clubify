'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, getUser } from '@/lib/api';
import { Icon } from '@/components/Icon';

type Storefront = {
  id: string;
  description: string;
  heroImageUrl: string | null;
  theme: any;
  blocks: any[];
  isPublished: boolean;
  customDomain: string | null;
};

export default function StorefrontEditor() {
  const [sf, setSf] = useState<Storefront | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const slug = (typeof window !== 'undefined' ? window.location.host : 'clubify.app') + '/m/cafe-del-dia';

  async function load() {
    const data = await api<Storefront>('/storefront');
    setSf(data);
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
          customDomain: sf.customDomain || null,
        }),
      });
      setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  }

  if (!sf) return <div className="text-mute">Cargando…</div>;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          Mi sitio <span className="page-crumb">/ {sf.isPublished ? 'Publicado' : 'Borrador'}</span>
        </h1>
        <div className="flex gap-2">
          <Link
            href="/m/cafe-del-dia"
            target="_blank"
            className="btn-ghost"
          >
            <Icon name="arrow-right" /> Ver sitio público
          </Link>
          <button className="btn-primary" onClick={save} disabled={saving}>
            <Icon name="check" /> {saving ? 'Guardando…' : 'Publicar cambios'}
          </button>
        </div>
      </div>

      {savedAt && (
        <div className="rounded-lg bg-ok-soft text-ok-ink px-3 py-2 mb-4 text-sm">
          ✓ Guardado a las {savedAt.toLocaleTimeString('es-CO')}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card card-pad">
          <h3 className="text-base font-semibold m-0 mb-4">Información general</h3>
          <div>
            <label className="label">Descripción corta</label>
            <textarea
              className="input"
              placeholder="Café de especialidad en el centro de Bogotá."
              value={sf.description ?? ''}
              onChange={(e) => setSf({ ...sf, description: e.target.value })}
            />
          </div>
          <div className="mt-3">
            <label className="label">URL imagen hero</label>
            <input
              className="input"
              placeholder="https://..."
              value={sf.heroImageUrl ?? ''}
              onChange={(e) => setSf({ ...sf, heroImageUrl: e.target.value })}
            />
          </div>
          <div className="mt-3">
            <label className="label">Estado</label>
            <select
              className="input"
              value={sf.isPublished ? '1' : '0'}
              onChange={(e) =>
                setSf({ ...sf, isPublished: e.target.value === '1' })
              }
            >
              <option value="1">Publicado</option>
              <option value="0">Borrador (oculto)</option>
            </select>
          </div>
          <div className="mt-3">
            <label className="label">Dominio propio (opcional)</label>
            <input
              className="input"
              placeholder="mi-negocio.com"
              value={sf.customDomain ?? ''}
              onChange={(e) =>
                setSf({ ...sf, customDomain: e.target.value })
              }
            />
            <div className="text-[11px] text-mute mt-1.5 leading-relaxed">
              Configura un dominio (ej. <code>cafedeldia.com</code>) que apunte
              a Clubify. Necesitas crear un registro <b>A</b> o <b>CNAME</b> en
              tu DNS. Ver instrucciones de Caddy en <code>PENDIENTES.md</code>.
            </div>
          </div>

          <h3 className="text-base font-semibold mt-6 mb-4">Bloques del sitio</h3>
          <p className="text-mute text-xs mb-3">
            Drag para reordenar (próximamente). Por ahora se muestran en este orden.
          </p>
          <div className="space-y-2">
            {(sf.blocks ?? []).map((b: any, i: number) => (
              <div
                key={i}
                className="border border-line2 rounded-lg p-3 flex items-center justify-between"
              >
                <div>
                  <div className="font-medium text-sm capitalize">{b.type}</div>
                  <div className="text-xs text-mute">
                    {b.type === 'hero'
                      ? 'Logo + nombre + descripción'
                      : b.type === 'social'
                      ? 'Botones WhatsApp / IG / Maps'
                      : b.type === 'menu'
                      ? 'Catálogo de productos'
                      : b.type === 'cards'
                      ? 'Tarjetas de fidelización'
                      : 'Promociones activas'}
                  </div>
                </div>
                <button
                  className="text-bad text-xs"
                  onClick={() => {
                    const arr = [...sf.blocks];
                    arr.splice(i, 1);
                    setSf({ ...sf, blocks: arr });
                  }}
                >
                  Quitar
                </button>
              </div>
            ))}
          </div>
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
              <option value="">+ Agregar bloque</option>
              <option value="hero">Hero</option>
              <option value="social">Botones sociales</option>
              <option value="menu">Menú</option>
              <option value="cards">Tarjetas</option>
              <option value="promotions">Promociones</option>
            </select>
          </div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-mute font-semibold mb-2.5">
            Vista previa
          </div>
          <div className="flex justify-center">
            <div className="iphone">
              <div className="iphone-notch" />
              <div className="iphone-screen overflow-auto" style={{ minHeight: 540 }}>
                <div className="iphone-bar">
                  <span>11:42</span>
                  <span className="text-[10px]">●●● 100%</span>
                </div>
                <div className="px-4 pb-4">
                  <div className="font-bold text-lg">Café del Día</div>
                  <div className="text-xs text-mute mt-0.5">{sf.description}</div>
                  <div className="flex gap-1.5 mt-3 text-xs">
                    <span className="px-2 py-1 rounded-full bg-brand text-white">📞 WA</span>
                    <span className="px-2 py-1 rounded-full bg-bg2">📷 IG</span>
                    <span className="px-2 py-1 rounded-full bg-bg2">📍 Maps</span>
                  </div>
                  <div className="mt-3 flex gap-1 text-[10px]">
                    <span className="px-2 py-1 rounded-full bg-brand text-white">Menú</span>
                    <span className="px-2 py-1 rounded-full bg-bg2">Tarjeta</span>
                    <span className="px-2 py-1 rounded-full bg-bg2">Promos</span>
                  </div>
                  <div className="mt-3 text-mute text-[10px] uppercase tracking-wider">
                    Vista simplificada · {sf.blocks.length} bloques
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-3 text-center text-xs text-mute">
            <code>{slug}</code>
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/Toast';
import { ImageUploader } from '@/components/ImageUploader';
import { StampIconPicker } from '@/components/StampIconPicker';
import { WalletPassPreview } from '@/components/WalletPassPreview';

type DisenoCard = {
  id: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
  stampIcon: string | null;
  stampIconImageUrl: string | null;
  stampBgType: 'GRADIENT' | 'SOLID' | 'IMAGE';
  stampBgImageUrl: string | null;
  /** El nombre que el socio ve ARRIBA en su tarjeta: el del negocio. */
  businessName: string;
};

/**
 * El aspecto de la tarjeta del plan: lo que el socio ve en el móvil.
 *
 * Vive aquí y no en el editor general de tarjetas por dos razones. La de forma:
 * el negocio acaba de crear su plan y no tiene por qué saber que su tarjeta
 * está en otra sección. Y la de fondo: aquel editor enseña campos que en un
 * club no significan nada —cuántos sellos, el premio, la conversión a otra
 * tarjeta— y uno que además ROMPE, porque `stampsRequired` es el cupo del mes y
 * lo reescribe el plan cada vez que se guarda.
 */
export function Diseno({
  planId,
  plan,
  unidad,
  cupo,
}: {
  planId: string;
  plan: string;
  unidad: string;
  cupo: number;
}) {
  const [d, setD] = useState<DisenoCard | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    api(`/club/planes/${planId}/diseno`)
      .then(setD)
      .catch(() => setD(null));
  }, [planId]);

  function set<K extends keyof DisenoCard>(k: K, v: DisenoCard[K]) {
    setD((x) => (x ? { ...x, [k]: v } : x));
  }

  async function guardar() {
    if (!d) return;
    setGuardando(true);
    try {
      const r = await api(`/club/planes/${planId}/diseno`, {
        method: 'PATCH',
        body: JSON.stringify({
          primaryColor: d.primaryColor,
          secondaryColor: d.secondaryColor,
          logoUrl: d.logoUrl,
          stampIcon: d.stampIcon || undefined,
          stampIconImageUrl: d.stampIconImageUrl,
          stampBgType: d.stampBgType,
          stampBgImageUrl: d.stampBgImageUrl,
        }),
      });
      setD(r);
      toast('Guardado. Tus socios lo verán en su tarjeta.', 'success');
    } catch (e: any) {
      toast(e.message || 'No se pudo guardar el diseño.', 'error');
    } finally {
      setGuardando(false);
    }
  }

  if (!d) return null;

  return (
    <div className="card card-pad mt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold m-0">Diseño de la tarjeta</h2>
          <p className="text-xs text-mute mt-1 max-w-xl">
            Cómo la ve el socio en el móvil. Al guardar, se actualiza también la
            de quienes ya la tienen instalada.
          </p>
        </div>
        <button className="btn-ghost shrink-0" onClick={() => setAbierto((v) => !v)}>
          {abierto ? 'Ocultar' : 'Editar'}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-6">
        <div className="shrink-0">
          <WalletPassPreview
            size="md"
            brandName={d.businessName || plan}
            brandLogoUrl={d.logoUrl}
            primaryColor={d.primaryColor}
            secondaryColor={d.secondaryColor}
            cardName={plan}
            cardType="STAMPS"
            club={{ unidad, cupo }}
            stampsRequired={cupo}
            stampsCount={cupo}
            stampIcon={d.stampIcon || '☕'}
            stampIconImageUrl={d.stampIconImageUrl}
            stampBgType={d.stampBgType}
            stampBgImageUrl={d.stampBgImageUrl}
          />
        </div>

        {abierto && (
          <div className="flex-1 min-w-[280px] space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Color principal</label>
                <input
                  type="color"
                  className="input h-11 p-1"
                  value={d.primaryColor}
                  onChange={(e) => set('primaryColor', e.target.value)}
                />
              </div>
              <div>
                <label className="label">Color secundario</label>
                <input
                  type="color"
                  className="input h-11 p-1"
                  value={d.secondaryColor}
                  onChange={(e) => set('secondaryColor', e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="label">Logo</label>
              <ImageUploader
                value={d.logoUrl}
                onChange={(url) => set('logoUrl', url)}
                folder="wallet-logos"
                crop={false}
                minDimensionWarn={false}
              />
            </div>

            <div>
              <label className="label">
                Icono de cada {unidad || 'beneficio'}
              </label>
              <StampIconPicker
                value={d.stampIcon || '☕'}
                onSelect={(icon) => set('stampIcon', icon)}
                imageUrl={d.stampIconImageUrl}
                onImageChange={(url) => set('stampIconImageUrl', url)}
              />
            </div>

            <button
              className="btn-primary"
              onClick={guardar}
              disabled={guardando}
            >
              {guardando ? 'Guardando…' : 'Guardar diseño'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

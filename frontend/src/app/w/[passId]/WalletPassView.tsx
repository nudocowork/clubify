'use client';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { BrandBadge, type BrandBadgeBrand } from '@/components/BrandBadge';
import { WalletPassPreview } from '@/components/WalletPassPreview';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useT } from '@/lib/i18n';

type Props = {
  passId: string;
  data: any;
  googleSaveUrl: string | null;
};

export function WalletPassView({ passId, data, googleSaveUrl }: Props) {
  const tt = useT();
  // Detectar plataforma para reordenar los botones — el "save" del nativo
  // del usuario va primero. iOS → Apple primero. Android → Google primero.
  const [platform, setPlatform] = useState<'ios' | 'android' | 'other'>('other');
  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) setPlatform('ios');
    else if (/android/.test(ua)) setPlatform('android');
  }, []);
  return (
    <div className="min-h-screen bg-gradient-to-b from-bg via-bg to-bg2/30">
      <div className="max-w-md mx-auto px-5 py-10 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <div className="text-center mb-6">
          <div className="text-[11px] uppercase tracking-[0.2em] text-mute font-semibold">
            {tt('wallet.show_at_counter')}
          </div>
          <h1 className="text-xl font-bold mt-1">{data.tenant.brandName}</h1>
          <div className="text-sm text-mute">{data.card.name}</div>
        </div>

        <div className="flex justify-center">
          <WalletPassPreview
            brandName={data.tenant.brandName}
            brandLogoUrl={
              data.tenant.walletLogoUrl ??
              data.tenant.logoUrl ??
              data.brand?.logoUrl ??
              data.brand?.iconUrl ??
              null
            }
            primaryColor={data.card.primaryColor}
            secondaryColor={data.card.secondaryColor}
            cardName={data.card.name}
            cardType={data.card.type}
            stampsRequired={data.card.stampsRequired}
            stampsCount={data.stampsCount ?? 0}
            visitsRequired={data.card.visitsRequired}
            visitsCount={data.visitsCount ?? 0}
            cashbackBalance={Number(data.cashbackBalance ?? 0)}
            pointsBalance={Number(data.pointsBalance ?? 0)}
            discountPercent={data.card.discountPercent}
            currentTier={data.currentTier}
            tiers={data.card.tiers ?? []}
            stampIcon={data.card.stampIcon || '☕'}
            // Ícono propio (imagen): prima sobre el emoji, igual que en el pase
            // real. Sin esto la tarjeta web del cliente mostraba el emoji.
            stampIconImageUrl={data.card.stampIconImageUrl ?? null}
            stampActiveColor={data.card.stampActiveColor}
            stampInactiveColor={data.card.stampInactiveColor}
            stampContourColor={data.card.stampContourColor}
            centerBgColor={data.card.centerBgColor}
            rewardText={data.card.rewardText}
            customerName={(data.customer?.fullName ?? '').toUpperCase() || '—'}
            barcodeValue={data.serialNumber ?? data.qrToken}
          />
        </div>

        <div className="space-y-2.5 mt-6">
          {/* En Android, el botón principal es Google Wallet. iOS y desktop → Apple. */}
          {platform === 'android' && googleSaveUrl ? (
            <>
              <a
                href={googleSaveUrl}
                className="btn-primary w-full justify-center hover:opacity-90 active:scale-[0.98] transition"
                style={{ background: '#000', borderColor: '#000' }}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="google" /> {tt('wallet.add_google')}
              </a>
              <a
                href={`/w/${passId}/apple`}
                className="btn-ghost w-full justify-center active:scale-[0.98] transition"
                download
              >
                <Icon name="apple" /> {tt('wallet.add_apple')}
              </a>
            </>
          ) : (
            <>
              <a
                href={`/w/${passId}/apple`}
                className="btn-primary w-full justify-center hover:opacity-90 active:scale-[0.98] transition"
                style={{ background: '#000', borderColor: '#000' }}
                download
              >
                <Icon name="apple" /> {tt('wallet.add_apple')}
              </a>
              {googleSaveUrl && (
                <a
                  href={googleSaveUrl}
                  className="btn-ghost w-full justify-center active:scale-[0.98] transition"
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="google" /> {tt('wallet.add_google')}
                </a>
              )}
            </>
          )}
        </div>

        {data.card.terms && (
          <div className="card card-pad mt-6">
            <div className="text-[11px] uppercase tracking-[0.12em] text-mute font-semibold">
              {tt('wallet.terms')}
            </div>
            <div className="text-sm mt-2 leading-relaxed">{data.card.terms}</div>
          </div>
        )}
        {/* Marca del negocio (per marca blanca). Fallback Clubify mientras
            el backend propaga el deploy. */}
        {/* Sin marca resuelta NO se pinta nada. Antes caía a Clubify por
            defecto: el cliente de un negocio Sellea veía «Hecho con Clubify»
            en su tarjeta. Un pie ausente no delata a nadie; uno inventado sí. */}
        {data.brand ? (
          <BrandBadge brand={data.brand as BrandBadgeBrand} />
        ) : null}
        <LanguageSwitcher />
      </div>
    </div>
  );
}

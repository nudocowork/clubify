'use client';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { BrandBadge, type BrandBadgeBrand } from '@/components/BrandBadge';
import { WalletPassPreview } from '@/components/WalletPassPreview';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useT, useLocale } from '@/lib/i18n';

type Props = {
  passId: string;
  data: any;
  googleSaveUrl: string | null;
  /** Viene de `?welcome=1`: acaba de registrarse y todavía no instaló la
   *  tarjeta. Cambia el orden de la pantalla — ver abajo. */
  welcome?: boolean;
};

export function WalletPassView({
  passId,
  data,
  googleSaveUrl,
  welcome = false,
}: Props) {
  const tt = useT();
  const [locale] = useLocale();
  // Detectar plataforma para reordenar los botones — el "save" del nativo
  // del usuario va primero. iOS → Apple primero. Android → Google primero.
  const [platform, setPlatform] = useState<'ios' | 'android' | 'other'>('other');
  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) setPlatform('ios');
    else if (/android/.test(ua)) setPlatform('android');
  }, []);

  // Los badges oficiales que tenemos están en español. A un cliente que eligió
  // inglés o portugués no se le pinta un botón en español: para esos idiomas
  // se usa el botón con el texto traducido, que respeta igual el negro y el
  // logo de cada plataforma.
  const badgesOficiales = locale === 'es';
  const primary = data.card.primaryColor || '#16A34A';

  const appleBtn = badgesOficiales ? (
    <a href={`/w/${passId}/apple`} download className="block active:scale-[0.98] transition">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/wallet-badges/apple-es.svg"
        alt={tt('wallet.add_apple')}
        className="h-[52px] w-auto mx-auto"
      />
    </a>
  ) : (
    <a
      href={`/w/${passId}/apple`}
      download
      className="btn-primary w-full justify-center hover:opacity-90 active:scale-[0.98] transition"
      style={{ background: '#000', borderColor: '#000' }}
    >
      <Icon name="apple" /> {tt('wallet.add_apple')}
    </a>
  );

  const googleBtn = !googleSaveUrl ? null : badgesOficiales ? (
    <a
      href={googleSaveUrl}
      target="_blank"
      rel="noreferrer"
      className="block active:scale-[0.98] transition"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/wallet-badges/google-es.png"
        alt={tt('wallet.add_google')}
        className="h-[52px] w-auto mx-auto"
      />
    </a>
  ) : (
    <a
      href={googleSaveUrl}
      target="_blank"
      rel="noreferrer"
      className="btn-ghost w-full justify-center active:scale-[0.98] transition"
    >
      <Icon name="google" /> {tt('wallet.add_google')}
    </a>
  );

  // En Android el botón principal es Google Wallet. iOS y escritorio → Apple.
  const botones = (
    <div className="space-y-2.5">
      {platform === 'android' && googleBtn ? (
        <>
          {googleBtn}
          {appleBtn}
        </>
      ) : (
        <>
          {appleBtn}
          {googleBtn}
        </>
      )}
    </div>
  );

  const tarjeta = (
    <WalletPassPreview
      // Tras registrarse la tarjeta va en pequeño: es una confirmación de que
      // se creó, no el protagonista. En grande empujaba los botones de
      // instalación fuera de pantalla en un iPhone SE, y como la tarjeta ya se
      // veía, el cliente creía que había terminado y cerraba sin instalarla.
      size={welcome ? 'sm' : 'md'}
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
      logoBgColor={data.card.logoBgColor}
      rewardText={data.card.rewardText}
      customerName={(data.customer?.fullName ?? '').toUpperCase() || '—'}
      barcodeValue={data.serialNumber ?? data.qrToken}
    />
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-bg via-bg to-bg2/30">
      <div
        className={`max-w-md mx-auto px-5 animate-in fade-in slide-in-from-bottom-2 duration-300 ${
          welcome ? 'py-6' : 'py-10'
        }`}
      >
        {welcome ? (
          /* ── Acaba de registrarse ──────────────────────────────────────
             El aviso y los botones van ARRIBA, y la tarjeta debajo. El orden
             importa: en una pantalla de 568 px (iPhone SE) solo entra lo
             primero, y lo primero tiene que ser la acción que falta. */
          <>
            <div
              className="rounded-2xl p-4 text-center border-2"
              style={{ borderColor: primary, background: `${primary}0F` }}
            >
              {data.tenant.walletLogoUrl || data.tenant.logoUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={data.tenant.walletLogoUrl ?? data.tenant.logoUrl}
                  alt={data.tenant.brandName}
                  className="h-9 w-9 rounded-lg object-cover mx-auto mb-2"
                />
              ) : null}
              <h1
                className="text-[17px] leading-tight font-extrabold tracking-tight"
                style={{ color: primary }}
              >
                {tt('wallet.not_done_title')}
              </h1>
              <p className="text-[13px] text-ink mt-1.5 leading-snug">
                {tt('wallet.not_done_sub')}
              </p>
            </div>

            {/* Indicador que lleva la vista del aviso a los botones. */}
            <div
              className="text-center text-[11px] uppercase tracking-[0.16em] font-semibold mt-3 mb-1.5"
              style={{ color: primary }}
            >
              {tt('wallet.install_below')}
              <div className="text-base leading-none mt-0.5 animate-bounce">↓</div>
            </div>

            {botones}

            <div className="flex justify-center mt-6">{tarjeta}</div>
            <div className="text-center text-[11px] text-mute mt-2">
              {data.tenant.brandName} · {data.card.name}
            </div>
          </>
        ) : (
          /* ── Vuelve a abrir su tarjeta ────────────────────────────────
             Ya la tiene: manda el código para el mostrador. No se le repite
             que «no ha terminado», porque sí terminó. */
          <>
            <div className="text-center mb-6">
              <div className="text-[11px] uppercase tracking-[0.2em] text-mute font-semibold">
                {tt('wallet.show_at_counter')}
              </div>
              <h1 className="text-xl font-bold mt-1">{data.tenant.brandName}</h1>
              <div className="text-sm text-mute">{data.card.name}</div>
            </div>

            <div className="flex justify-center">{tarjeta}</div>

            <div className="mt-6">{botones}</div>
          </>
        )}

        {data.card.terms && (
          <div className="card card-pad mt-6">
            <div className="text-[11px] uppercase tracking-[0.12em] text-mute font-semibold">
              {tt('wallet.terms')}
            </div>
            <div className="text-sm mt-2 leading-relaxed">{data.card.terms}</div>
          </div>
        )}
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

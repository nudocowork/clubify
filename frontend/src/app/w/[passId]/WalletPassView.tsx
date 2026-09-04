'use client';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { BrandBadge, type BrandBadgeBrand } from '@/components/BrandBadge';
import { WalletPassPreview } from '@/components/WalletPassPreview';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useT, useLocale } from '@/lib/i18n';
import { CompletarRegistro } from './CompletarRegistro';

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
  // El socio del club llega aquí sin haber pasado por ningún formulario: se dio
  // de alta en el mostrador con un solo dato. Se le piden los huecos ANTES de
  // enseñarle los botones — si ve «instalar» primero, instala y no vuelve.
  const falta = data.registro ?? null;
  const [registroPendiente, setRegistroPendiente] = useState(
    Boolean(
      falta && (falta.faltaNombre || falta.faltaEmail || falta.faltaCumple),
    ),
  );
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
      // Tras registrarse la tarjeta va en pequeño y SIN el marco de iPhone.
      //
      // El marco era el problema de fondo: al ver un móvil con la tarjeta
      // dentro, el cliente entendía que ya la tenía instalada y cerraba. Y
      // ocupaba tanto alto que empujaba los botones fuera de pantalla en un
      // iPhone SE. Aquí la tarjeta es la confirmación de que se creó, no el
      // protagonista.
      size={welcome ? 'sm' : 'md'}
      bare={welcome}
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
      // Tarjeta de club: lo manda el backend cuando la tarjeta es de un plan.
      // Sin esto, la página que el negocio le manda al socio para instalarla
      // le enseñaba «SELLOS 7/10» — el número al revés.
      club={data.club ?? null}
      // Tarjeta de alianza: por lo mismo que el club. Sin esto le enseñaba
      // «SELLOS 0 / 1» al empleado en la página de instalación.
      alianza={data.alianza ?? null}
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
      logoShape={data.card.logoShape}
      // En una alianza, los beneficios vivos: «10% de descuento · Bebida
      // gratis». `card.rewardText` es el relleno «Beneficios de <empresa>» que
      // pone la plantilla, que no le dice a la persona QUÉ le dan.
      rewardText={
        data.alianza
          ? data.alianza.vivos.join(' · ') || `Consulta con ${data.alianza.empresa}`
          : data.card.rewardText
      }
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
             Orden: marca → «aún no has terminado» → tarjeta pequeña y sin
             marco → «instala tu tarjeta» + flecha → botones.

             En 568 px (iPhone SE) solo entra lo primero, así que todo lo de
             arriba tiene que caber y acabar en los botones. La tarjeta va en
             medio a propósito: es lo que el cliente reconoce como «ya está»,
             y justo debajo es donde hay que decirle que falta un paso. */
          <>
            <div className="text-center">
              <div className="text-[10px] uppercase tracking-[0.2em] text-mute font-semibold">
                {tt('wallet.show_at_counter')}
              </div>
              <h1 className="text-[15px] font-bold mt-0.5">
                {data.tenant.brandName}
              </h1>
              <div className="text-[12px] text-mute">{data.card.name}</div>
            </div>

            <h2
              className="text-[19px] leading-[1.15] font-extrabold tracking-tight text-center mt-3"
              style={{ color: primary }}
            >
              {tt('wallet.not_done_title')}
            </h2>

            <div className="flex justify-center mt-3">{tarjeta}</div>

            {registroPendiente && falta ? (
              <CompletarRegistro
                passId={passId}
                falta={falta}
                primary={primary}
                onListo={() => setRegistroPendiente(false)}
              />
            ) : (
            <>
            {/* El texto y las flechas van ENTRE la tarjeta y los botones, no
                antes: es el punto exacto donde el cliente cree que terminó.
                Ahí es donde hay que decirle que le falta un paso. */}
            <div className="text-center mt-3">
              <div className="text-[13px] leading-snug text-ink">
                {tt('wallet.not_done_sub')}
              </div>
              <div
                className="text-xl leading-none mt-1 animate-bounce"
                style={{ color: primary }}
                aria-hidden="true"
              >
                ⌄
              </div>
            </div>

            <div className="mt-2">{botones}</div>
            </>
            )}
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

'use client';
/**
 * Preview premium de tarjeta wallet — usado en:
 *   - /app/cards/new (wizard, vista en vivo de la tarjeta que se está creando)
 *   - /app/cards/[id] tab Detalle (preview de la card existente)
 *   - /w/[passId] (cliente final, antes de que instale en su wallet)
 *
 * Diseño inspirado en Apple Wallet / Starbucks Rewards:
 *   - Sombra de color (mismo tinte que primaryColor)
 *   - Border radius 24px
 *   - Header con logo del tenant + brand name
 *   - Side info (sellos / saldo / visitas / tier según card.type)
 *   - Strip dinámico: stamps grid para STAMPS/HYBRID/VISITS,
 *     balance card para CASHBACK/POINTS, tier display para MEMBERSHIP
 *   - Fields TITULAR / RECOMPENSA
 *   - Barcode opcional abajo
 *   - Pager dots estilo iOS
 */
import { Barcode } from '@/components/Barcode';

export type WalletPassPreviewProps = {
  brandName: string;
  brandLogoUrl?: string | null;
  primaryColor: string;
  secondaryColor: string;
  cardName: string;
  cardType:
    | 'STAMPS'
    | 'POINTS'
    | 'DISCOUNT'
    | 'MEMBERSHIP'
    | 'COUPON'
    | 'GIFT'
    | 'MULTI'
    | 'CASHBACK'
    | 'VISITS'
    | 'HYBRID';
  stampsRequired?: number | null;
  stampsCount?: number;
  visitsRequired?: number | null;
  visitsCount?: number;
  cashbackBalance?: number;
  pointsBalance?: number;
  discountPercent?: number | null;
  currentTier?: string | null;
  tiers?: Array<{ name: string }>;
  stampIcon?: string;
  stampActiveColor?: string | null;
  stampInactiveColor?: string | null;
  stampContourColor?: string | null;
  centerBgColor?: string | null;
  // Wallet V3 — modo de fondo del área de sellos.
  stampBgType?: 'GRADIENT' | 'SOLID' | 'IMAGE';
  stampBgImageUrl?: string | null;
  // Wallet V3 — Premios Free (dibujados en su posición) + "Próximo Premio".
  freeRewards?: Array<{
    pos: number;
    text?: string | null;
    emoji?: string | null;
    circleColor?: string | null;
    textColor?: string | null;
    active?: boolean;
  }>;
  showNextReward?: boolean;
  rewardText?: string;
  customerName?: string;
  barcodeValue?: string;
  /** Tamaño del frame iPhone. Default 260px de ancho. */
  size?: 'sm' | 'md' | 'lg';
  /** Si true, renderiza solo el pase sin el iPhone wrapper. */
  bare?: boolean;
};

export function WalletPassPreview(props: WalletPassPreviewProps) {
  const {
    brandName,
    brandLogoUrl,
    primaryColor,
    secondaryColor,
    cardName,
    cardType,
    stampsRequired = 10,
    stampsCount = 0,
    visitsRequired = 10,
    visitsCount = 0,
    cashbackBalance = 0,
    pointsBalance = 0,
    discountPercent = 10,
    currentTier,
    tiers,
    stampIcon = '☕',
    stampActiveColor,
    stampInactiveColor,
    stampContourColor,
    centerBgColor,
    stampBgType = 'GRADIENT',
    stampBgImageUrl,
    freeRewards = [],
    showNextReward = true,
    rewardText = '',
    customerName = 'TU NOMBRE',
    barcodeValue,
    size = 'md',
    bare = false,
  } = props;

  const isProgressType =
    cardType === 'STAMPS' || cardType === 'HYBRID' || cardType === 'VISITS';
  const required =
    cardType === 'VISITS' ? visitsRequired ?? 10 : stampsRequired ?? 10;
  const current = cardType === 'VISITS' ? visitsCount : stampsCount;
  const previewStamps = Math.max(1, Math.min(required, 12));

  // Wallet V3 — Premios Free por posición (1-based) + "Próximo Premio".
  const activePrizes = (freeRewards || []).filter(
    (p) => p && p.active !== false && Number(p.pos) >= 1,
  );
  const prizeByPos = new Map<number, (typeof activePrizes)[number]>();
  for (const p of activePrizes) prizeByPos.set(Math.floor(Number(p.pos)), p);
  const nextPrize = (() => {
    // Solo si hay Premios Free activos → tarjetas sin premios intermedios
    // conservan "Recompensa" (no cambia el aspecto de las existentes).
    if (!showNextReward || !isProgressType || activePrizes.length === 0) return null;
    const cands: Array<{ pos: number; label: string }> = [];
    for (const p of activePrizes) {
      const label = [p.emoji, p.text].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
      if (label) cands.push({ pos: Math.floor(Number(p.pos)), label });
    }
    if (required && (rewardText || '').trim()) {
      cands.push({ pos: Math.floor(required), label: (rewardText || '').trim() });
    }
    return cands.filter((c) => c.pos > current).sort((a, b) => a.pos - b.pos)[0] ?? null;
  })();

  // Colores resueltos — estilo premium tipo Starbucks/Apple Wallet:
  // filled = círculo blanco sólido con ícono en color de la marca;
  // empty = relleno sutil sin borde visible.
  const activeBg = stampActiveColor || '#FFFFFF';
  const activeFg = stampActiveColor ? '#FFFFFF' : primaryColor;
  const inactiveBg = stampInactiveColor || 'rgba(255,255,255,.13)';
  // Sólo dibujamos contorno si el usuario lo configura explícitamente,
  // si no, omitimos para evitar el look "marcado".
  const contourCol = stampContourColor || null;

  const sideHeader = (() => {
    switch (cardType) {
      case 'CASHBACK':
        return {
          lbl: 'SALDO',
          val: `$${Math.round(cashbackBalance).toLocaleString('es-CO')}`,
        };
      case 'VISITS':
        return { lbl: 'VISITAS', val: `${visitsCount}/${required}` };
      case 'POINTS':
        return { lbl: 'PUNTOS', val: `${Math.round(pointsBalance)}` };
      case 'MEMBERSHIP':
        return {
          lbl: 'NIVEL',
          val: currentTier || tiers?.[0]?.name || 'Activa',
        };
      case 'DISCOUNT':
        return { lbl: 'OFF', val: `${discountPercent ?? 10}%` };
      case 'COUPON':
        // CUPÓN no muestra conteo de sellos. Si tiene discountPercent
        // configurado, lo mostramos como valor; sino, "DISPONIBLE"
        // (matchea la lógica del .pkpass real en wallet.service.ts).
        return {
          lbl: 'CUPÓN',
          val:
            discountPercent && discountPercent > 0
              ? `${discountPercent}%`
              : 'DISPONIBLE',
        };
      case 'GIFT':
        // Gift tampoco es de progreso — mostramos label genérico para
        // que no caiga al default y muestre "SELLOS x/y".
        return { lbl: 'REGALO', val: 'DISPONIBLE' };
      default:
        return { lbl: 'SELLOS', val: `${stampsCount}/${required}` };
    }
  })();

  const initial = (brandName?.[0] || 'C').toUpperCase();

  // Sombra con tinte del color primario para look premium
  const passShadow = `0 32px 64px -16px ${primaryColor}66, 0 12px 24px -8px rgba(0,0,0,.18), inset 0 0 0 1px rgba(255,255,255,.08)`;

  const sizeClass =
    size === 'sm'
      ? 'w-[200px]'
      : size === 'lg'
        ? 'w-[300px]'
        : 'w-[260px]';

  const passContent = (
    <div
      className="rounded-[24px] text-white overflow-hidden flex flex-col relative"
      style={{
        background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
        boxShadow: passShadow,
      }}
    >
      {/* Subtle noise/sheen overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.06]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 0%, rgba(255,255,255,.4), transparent 50%)',
        }}
      />

      {/* Header: brand + side metric */}
      <div className="flex items-start justify-between gap-2.5 px-4 pt-3.5 pb-2 relative">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-7 h-7 rounded-md bg-white/15 backdrop-blur flex items-center justify-center font-bold text-[12px] shrink-0 overflow-hidden"
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
          <div className="text-[12px] font-bold truncate uppercase tracking-wide">
            {brandName || 'Tu marca'}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[9px] tracking-[0.14em] uppercase opacity-80 font-semibold">
            {sideHeader.lbl}
          </div>
          <div className="text-sm font-bold mt-0.5 leading-tight">
            {sideHeader.val}
          </div>
        </div>
      </div>

      {/* Strip / display central según tipo */}
      <div className="px-4 pb-3 relative">
        {isProgressType && (
          <div
            className="rounded-2xl px-3 py-3 relative overflow-hidden"
            style={
              // Wallet V3 — modo de fondo del área de sellos:
              //  IMAGE  → imagen cover centrada (+ overlay oscuro para legibilidad)
              //  SOLID  → uniforme: mismo color de la tarjeta (o transparente)
              //  GRADIENT (legacy) → degradado como antes
              stampBgType === 'IMAGE' && stampBgImageUrl
                ? {
                    backgroundImage: `url(${stampBgImageUrl})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }
                : stampBgType === 'SOLID' || stampBgType === 'IMAGE'
                  ? { background: centerBgColor || 'transparent' }
                  : {
                      background: centerBgColor
                        ? `linear-gradient(135deg, ${centerBgColor}e6, ${centerBgColor}b3)`
                        : 'linear-gradient(135deg, rgba(0,0,0,.10) 0%, rgba(0,0,0,.22) 100%)',
                    }
            }
          >
            {/* Overlay: gloss sutil (GRADIENT) u oscuro para legibilidad (IMAGE).
                SOLID no lleva overlay → look completamente uniforme. */}
            {stampBgType === 'IMAGE' && stampBgImageUrl ? (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(0,0,0,.30) 0%, rgba(0,0,0,.62) 100%)',
                }}
              />
            ) : stampBgType === 'GRADIENT' ? (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,0) 55%)',
                }}
              />
            ) : null}
            <div className="relative flex items-center justify-between gap-1.5">
              {Array.from({ length: previewStamps }).map((_, i) => {
                const filled = i < current;
                const prize = prizeByPos.get(i + 1);
                if (prize) {
                  // Círculo de Premio Free: color propio + emoji/texto dentro +
                  // badge 🎁 en la esquina superior derecha.
                  const bg = prize.circleColor || (filled ? activeBg : inactiveBg);
                  const fg = prize.textColor || (filled ? activeFg : '#FFFFFF');
                  const label = (prize.text || '').trim();
                  return (
                    <div
                      key={i}
                      className="relative aspect-square rounded-full flex flex-col items-center justify-center transition-all flex-1 overflow-visible"
                      style={{
                        maxWidth: previewStamps > 8 ? '32px' : '40px',
                        background: bg,
                        color: fg,
                        boxShadow:
                          '0 4px 10px -2px rgba(0,0,0,.28), inset 0 0 0 1px rgba(255,255,255,.35)',
                        lineHeight: 1,
                      }}
                    >
                      {prize.emoji ? (
                        <span style={{ fontSize: previewStamps > 8 ? '11px' : '14px' }}>{prize.emoji}</span>
                      ) : null}
                      {label ? (
                        <span
                          className="font-bold text-center px-[1px]"
                          style={{
                            fontSize: previewStamps > 8 ? '5px' : '6.5px',
                            lineHeight: 1.05,
                            maxWidth: '100%',
                            overflow: 'hidden',
                          }}
                        >
                          {label}
                        </span>
                      ) : null}
                      <span
                        className="absolute -top-1 -right-1 rounded-full flex items-center justify-center bg-white shadow"
                        style={{
                          width: previewStamps > 8 ? '11px' : '14px',
                          height: previewStamps > 8 ? '11px' : '14px',
                          fontSize: previewStamps > 8 ? '7px' : '9px',
                        }}
                      >
                        🎁
                      </span>
                    </div>
                  );
                }
                return (
                  <div
                    key={i}
                    className="aspect-square rounded-full flex items-center justify-center transition-all flex-1"
                    style={{
                      maxWidth: previewStamps > 8 ? '32px' : '40px',
                      background: filled ? activeBg : inactiveBg,
                      color: filled ? activeFg : 'transparent',
                      fontWeight: 600,
                      fontSize: previewStamps > 8 ? '13px' : '17px',
                      lineHeight: 1,
                      boxShadow: filled
                        ? '0 4px 10px -2px rgba(0,0,0,.22), inset 0 0 0 1px rgba(255,255,255,.55)'
                        : 'none',
                      border: contourCol ? `1px solid ${contourCol}` : 'none',
                    }}
                  >
                    {filled ? stampIcon : ''}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {cardType === 'CASHBACK' && (
          <div className="rounded-2xl bg-black/20 px-3 py-4 text-center">
            <div className="text-[9px] tracking-[0.14em] uppercase opacity-80 font-semibold">
              Saldo disponible
            </div>
            <div className="text-2xl font-extrabold mt-1">
              ${Math.round(cashbackBalance).toLocaleString('es-CO')}
            </div>
          </div>
        )}

        {cardType === 'POINTS' && (
          <div className="rounded-2xl bg-black/20 px-3 py-4 text-center">
            <div className="text-[9px] tracking-[0.14em] uppercase opacity-80 font-semibold">
              Acumulados
            </div>
            <div className="text-2xl font-extrabold mt-1">
              {Math.round(pointsBalance)} <span className="text-base">pts</span>
            </div>
          </div>
        )}

        {cardType === 'MEMBERSHIP' && (
          <div className="rounded-2xl bg-black/20 px-3 py-3 text-center">
            <div className="text-[9px] tracking-[0.14em] uppercase opacity-80 font-semibold">
              Niveles del programa
            </div>
            <div className="text-sm font-bold mt-1">
              {(tiers ?? []).slice(0, 3).map((t) => t.name).join(' · ') ||
                'Membresía premium'}
            </div>
          </div>
        )}

        {cardType === 'DISCOUNT' && (
          <div className="rounded-2xl bg-black/20 px-3 py-3 text-center">
            <div className="text-3xl font-black leading-none">
              {discountPercent ?? 10}%
            </div>
            <div className="text-[9px] tracking-[0.14em] uppercase opacity-80 font-semibold mt-1">
              Descuento permanente
            </div>
          </div>
        )}

        {(cardType === 'GIFT' || cardType === 'COUPON') && (
          <div className="rounded-2xl bg-black/20 px-3 py-4 text-center">
            <div className="text-3xl">{cardType === 'GIFT' ? '🎁' : '🎟'}</div>
            <div className="text-[9px] tracking-[0.14em] uppercase opacity-80 font-semibold mt-1">
              {cardType === 'GIFT' ? 'Tarjeta regalo' : 'Cupón especial'}
            </div>
          </div>
        )}
      </div>

      {/* Fields TITULAR / RECOMPENSA */}
      <div className="px-4 pt-1 pb-3 grid grid-cols-[1fr_auto] gap-3 items-end relative">
        <div className="min-w-0">
          <div className="text-[9px] tracking-[0.14em] uppercase opacity-80 font-semibold">
            Titular
          </div>
          <div className="text-[13px] font-bold mt-0.5 truncate uppercase tracking-wide">
            {customerName}
          </div>
        </div>
        <div className="text-right max-w-[55%]">
          <div className="text-[9px] tracking-[0.14em] uppercase opacity-80 font-semibold">
            {nextPrize ? 'Próximo premio' : 'Recompensa'}
          </div>
          <div className="text-[12px] font-semibold mt-0.5 leading-snug line-clamp-2">
            {nextPrize ? nextPrize.label : rewardText || '—'}
          </div>
        </div>
      </div>

      {/* Barcode area */}
      {barcodeValue && (
        <div className="bg-white text-ink p-3 flex flex-col items-center gap-1.5 relative">
          <div className="rounded-md bg-white px-3 py-2 w-full max-w-[220px] flex justify-center">
            <Barcode
              value={barcodeValue}
              format="CODE128"
              height={52}
              width={1.3}
              displayValue={false}
            />
          </div>
          <div className="text-[10px] text-mute font-medium">
            Mostrar al cajero
          </div>
        </div>
      )}
    </div>
  );

  if (bare) return passContent;

  return (
    <div
      className={`${sizeClass} mx-auto`}
      style={{
        background: '#0F172A',
        borderRadius: 38,
        padding: 8,
        boxShadow:
          '0 30px 60px -15px rgba(15, 23, 42, 0.35), 0 0 0 1px #1E293B, 0 0 0 4px #0B1220',
        position: 'relative',
      }}
    >
      {/* Notch */}
      <div
        style={{
          position: 'absolute',
          top: 6,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 80,
          height: 18,
          background: '#0F172A',
          borderRadius: '0 0 12px 12px',
          zIndex: 5,
        }}
      />
      <div
        className="bg-white rounded-[30px] overflow-hidden"
        style={{ minHeight: 500 }}
      >
        {/* Status bar */}
        <div className="flex items-center justify-between px-4 pt-2.5 pb-1.5 text-[10px] font-semibold text-ink">
          <span>11:42</span>
          <span className="text-[10px]">●●● 100%</span>
        </div>
        {/* Wallet header bar */}
        <div className="flex items-center justify-between px-3.5 pb-2">
          <span className="text-[13px] text-info font-medium">OK</span>
          <span className="text-mute text-xs">↑ ···</span>
        </div>
        {/* The pass itself */}
        <div className="mx-2 mb-2">{passContent}</div>
      </div>
    </div>
  );
}

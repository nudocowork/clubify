'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, getUser } from '@/lib/api';
import { formatPrice, parsePriceInput } from '@/lib/money';
import { Icon } from '@/components/Icon';
import { ImageUploader } from '@/components/ImageUploader';
import { WalletStripRealPreview } from '@/components/WalletStripRealPreview';

const STEPS = ['Marca', 'WhatsApp', 'Categoría', 'Producto', 'Tarjeta', 'Listo'] as const;

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [tenant, setTenant] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Form data acumulado
  const [brand, setBrand] = useState({
    brandName: '',
    logoUrl: null as string | null,
    primaryColor: '#22C55E',
    secondaryColor: '#15803D',
  });
  const [whatsapp, setWhatsapp] = useState({
    whatsappPhone: '',
    instagramUrl: '',
    mapsUrl: '',
  });
  const [category, setCategory] = useState({ name: 'Menú principal' });
  const [product, setProduct] = useState({
    name: '',
    description: '',
    basePrice: 0,
    imageUrl: null as string | null,
  });
  // Subdivisiones del primer producto: mismo producto en varios tamaños /
  // presentaciones, cada una con su precio propio (el caso «Bandeja Paisa»:
  // Torre pequeña $34.900 · Torre personal $44.900). Se guardan como
  // ProductVariant con variantPriceMode='ABSOLUTE'. El precio se conserva
  // como texto crudo mientras se escribe: parsearlo en cada tecla rompe
  // montos a medio digitar («34.900»).
  const [subsOn, setSubsOn] = useState(false);
  const [subGroup, setSubGroup] = useState('Tamaño');
  const [subRows, setSubRows] = useState<{ name: string; price: string }[]>(
    [],
  );
  const [card, setCard] = useState({
    name: '',
    rewardText: '',
    stampsRequired: 10,
  });
  const [demoPass, setDemoPass] = useState<{
    passId: string;
    walletUrl: string;
  } | null>(null);

  // Error de la carga inicial, separado del `err` de guardado: antes un
  // fallo aquí (red móvil caída, sesión vencida) dejaba un «Cargando…»
  // eterno sin salida.
  const [loadErr, setLoadErr] = useState<string | null>(null);

  async function loadTenant() {
    setLoadErr(null);
    try {
      const t = await api<any>('/tenants/me');
      setTenant(t);
      setBrand({
        brandName: t.brandName || '',
        logoUrl: t.logoUrl,
        primaryColor: t.primaryColor || '#22C55E',
        secondaryColor: t.secondaryColor || '#15803D',
      });
      setWhatsapp({
        whatsappPhone: t.whatsappPhone || '',
        instagramUrl: t.instagramUrl || '',
        mapsUrl: t.mapsUrl || '',
      });
      setCard({
        name: `${t.brandName} — 10 sellos`,
        rewardText: '1 producto gratis',
        stampsRequired: 10,
      });

      // Resume desde el último paso guardado para este tenant
      try {
        const savedStep = localStorage.getItem(`clubify_onb_${t.id}`);
        if (savedStep) {
          const n = parseInt(savedStep, 10);
          if (Number.isFinite(n) && n > 0 && n <= 5) setStep(n);
        }
      } catch {}
    } catch (e: any) {
      setLoadErr(e?.message || 'No se pudo conectar con el servidor.');
    }
  }

  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.push('/login');
      return;
    }
    if (u.role === 'SUPER_ADMIN' || u.role === 'MARKETING') {
      router.push('/admin');
      return;
    }
    loadTenant();
    // loadTenant solo usa setters estables — no hace falta en las deps.
  }, [router]);

  // Persistir paso actual cuando cambia
  useEffect(() => {
    if (!tenant) return;
    try {
      localStorage.setItem(`clubify_onb_${tenant.id}`, String(step));
    } catch {}
  }, [step, tenant]);

  // Filas con nombre y precio válidos — lo que realmente se guardaría.
  const validSubs = subRows
    .map((r) => ({ name: r.name.trim(), price: parsePriceInput(r.price) }))
    .filter(
      (r): r is { name: string; price: number } =>
        r.name !== '' && r.price != null && r.price > 0,
    );
  const fmtMoney = (n: number) =>
    formatPrice(n, tenant?.currency ?? 'COP', {
      symbolOverride: tenant?.currencySymbol ?? null,
    });
  // Mismo criterio que la tarjeta del menú público (fmtProductPrice del
  // storefront): un solo precio si todas las subdivisiones valen igual,
  // «mín — máx» si difieren. Así lo que se promete aquí es lo que se ve.
  const subPreview = (() => {
    if (!validSubs.length) return null;
    const prices = validSubs.map((r) => r.price);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return min === max ? fmtMoney(min) : `${fmtMoney(min)} — ${fmtMoney(max)}`;
  })();

  function toggleSubs() {
    // Desactivar NO borra lo escrito: el onboarding se hace desde el
    // teléfono y un toque accidental no debe costar filas ya digitadas.
    // Las filas solo se envían cuando la casilla está activa.
    if (subsOn) {
      setSubsOn(false);
      return;
    }
    setSubsOn(true);
    if (subRows.length === 0) {
      setSubRows([
        { name: '', price: '' },
        { name: '', price: '' },
      ]);
    }
  }

  function removeSubRow(i: number) {
    const r = subRows[i];
    // Confirmar solo si la fila ya tiene algo escrito — borrar una fila
    // vacía no pierde nada.
    const hasData = r.name.trim() !== '' || r.price.trim() !== '';
    if (
      hasData &&
      !confirm(`¿Eliminar «${r.name.trim() || 'esta subdivisión'}»?`)
    ) {
      return;
    }
    setSubRows(subRows.filter((_, idx) => idx !== i));
  }

  async function next() {
    setErr(null);
    setBusy(true);
    try {
      switch (step) {
        case 0: // Marca
          await api('/tenants/me', {
            method: 'PATCH',
            body: JSON.stringify(brand),
          });
          break;
        case 1: // WhatsApp + redes
          await api('/tenants/me', {
            method: 'PATCH',
            body: JSON.stringify(whatsapp),
          });
          break;
        case 2: // Categoría
          if (!tenant.firstCategoryId) {
            const c = await api<any>('/catalog/categories', {
              method: 'POST',
              body: JSON.stringify({ name: category.name }),
            });
            setTenant({ ...tenant, firstCategoryId: c.id });
          }
          break;
        case 3: {
          // Producto
          if (!product.name.trim()) {
            throw new Error('Ponle un nombre a tu producto para continuar.');
          }
          const body: Record<string, unknown> = {
            ...product,
            name: product.name.trim(),
            categoryId: tenant.firstCategoryId,
          };
          if (subsOn) {
            // Filas totalmente vacías se ignoran; a medias se piden
            // completar: descartarlas en silencio guardaría el producto sin
            // un precio que el negocio cree haber puesto.
            const touched = subRows.filter(
              (r) => r.name.trim() !== '' || r.price.trim() !== '',
            );
            if (!validSubs.length) {
              throw new Error(
                'Agrega al menos una subdivisión con nombre y precio, o desmarca la casilla de subdivisiones.',
              );
            }
            if (validSubs.length < touched.length) {
              throw new Error(
                'Hay subdivisiones sin nombre o sin precio válido. Complétalas o elimínalas.',
              );
            }
            const prices = validSubs.map((r) => r.price);
            const min = Math.min(...prices);
            const max = Math.max(...prices);
            // Cada subdivisión trae su precio propio → ABSOLUTE (en ese
            // modo, `priceDelta` guarda el precio final). El precio del
            // producto pasa a derivarse de ellas: basePrice = mínimo y, si
            // difieren, RANGE con el máximo — así las vistas que no conocen
            // variantes muestran el mismo rango que el menú público.
            body.basePrice = min;
            body.priceMode = min === max ? 'FIXED' : 'RANGE';
            body.priceMax = min === max ? null : max;
            body.variantPriceMode = 'ABSOLUTE';
            body.variants = validSubs.map((r, i) => ({
              groupName: subGroup.trim() || 'Tamaño',
              name: r.name,
              priceDelta: r.price,
              isDefault: i === 0,
              position: i,
            }));
          }
          await api('/catalog/products', {
            method: 'POST',
            body: JSON.stringify(body),
          });
          break;
        }
        case 4: // Tarjeta + emitir pase demo del dueño
          const created = await api<any>('/cards', {
            method: 'POST',
            body: JSON.stringify({
              type: 'STAMPS',
              name: card.name,
              rewardText: card.rewardText,
              stampsRequired: card.stampsRequired,
              primaryColor: brand.primaryColor,
              secondaryColor: brand.secondaryColor,
            }),
          });

          try {
            const me = await api<any>('/customers', {
              method: 'POST',
              body: JSON.stringify({
                fullName: `${tenant.brandName} (tú)`,
                phone: whatsapp.whatsappPhone || `+57${Date.now().toString().slice(-9)}`,
                email: tenant.email,
              }),
            });
            const issued = await api<any>('/passes', {
              method: 'POST',
              body: JSON.stringify({ cardId: created.id, customerId: me.id }),
            });
            setDemoPass({
              passId: issued.id,
              walletUrl:
                typeof window !== 'undefined'
                  ? `${window.location.origin}/w/${issued.id}`
                  : `/w/${issued.id}`,
            });
          } catch {
            // si falla la emisión del pase demo, no bloqueo el onboarding
          }
          break;
      }
      setStep(step + 1);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function skip() {
    if (
      confirm(
        'Puedes terminar la configuración después desde el dashboard. ¿Saltar por ahora?',
      )
    ) {
      router.push('/app');
    }
  }

  if (!tenant) {
    if (loadErr) {
      return (
        <div className="min-h-screen bg-bg grid place-items-center p-6">
          <div className="card card-pad max-w-sm w-full text-center">
            <div className="font-semibold mb-1">
              No pudimos cargar tu negocio
            </div>
            <div className="text-sm text-mute mb-4">{loadErr}</div>
            <button
              className="btn-primary w-full justify-center"
              onClick={loadTenant}
            >
              Reintentar
            </button>
          </div>
        </div>
      );
    }
    return <div className="p-8 text-mute">Cargando…</div>;
  }

  return (
    <div className="min-h-screen bg-bg flex flex-col">
      {/* Top bar */}
      <header className="border-b border-line bg-white px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand text-white flex items-center justify-center font-bold">
              C
            </div>
            <div className="font-bold">Clubify</div>
          </div>
          <button onClick={skip} className="text-sm text-mute hover:text-ink">
            Saltar configuración →
          </button>
        </div>
      </header>

      {/* Stepper */}
      <div className="max-w-2xl mx-auto w-full px-6 pt-8">
        <div className="flex items-center justify-between text-[11px] text-mute mb-2">
          <span>
            Paso <b className="text-ink">{Math.min(step + 1, STEPS.length)}</b>{' '}
            de {STEPS.length}
          </span>
          <span>
            {Math.round((Math.min(step, STEPS.length - 1) / (STEPS.length - 1)) * 100)}%
            completo
          </span>
        </div>
        <div className="flex items-center gap-2 mb-2">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`flex-1 h-1.5 rounded-full transition ${
                i < step ? 'bg-brand' : i === step ? 'bg-brand/60' : 'bg-line'
              }`}
            />
          ))}
        </div>
        <div className="hidden sm:flex justify-between text-[10px] uppercase tracking-wider text-mute font-semibold">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={i === step ? 'text-brand' : ''}
            >
              {s}
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-8">
        {step === 0 && (
          <Step
            title="Empecemos por tu marca"
            subtitle="Estos datos aparecerán en tus tarjetas Wallet, en tu menú y en tus mensajes."
          >
            <div>
              <label className="label">Nombre comercial</label>
              <input
                className="input"
                value={brand.brandName}
                onChange={(e) =>
                  setBrand({ ...brand, brandName: e.target.value })
                }
                placeholder="Ej: Café del Día"
              />
            </div>
            <div className="mt-4">
              <label className="label">Logo (opcional)</label>
              <ImageUploader
                value={brand.logoUrl}
                onChange={(url) => setBrand({ ...brand, logoUrl: url })}
                folder="logos"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div>
                <label className="label">Color principal</label>
                <input
                  type="color"
                  className="input h-11 p-1"
                  value={brand.primaryColor}
                  onChange={(e) =>
                    setBrand({ ...brand, primaryColor: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="label">Color secundario</label>
                <input
                  type="color"
                  className="input h-11 p-1"
                  value={brand.secondaryColor}
                  onChange={(e) =>
                    setBrand({ ...brand, secondaryColor: e.target.value })
                  }
                />
              </div>
            </div>
          </Step>
        )}

        {step === 1 && (
          <Step
            title="¿Por dónde te llegan los pedidos?"
            subtitle="Tu WhatsApp es el canal principal. También puedes agregar Instagram y ubicación."
          >
            <div>
              <label className="label">WhatsApp del negocio</label>
              <input
                className="input"
                value={whatsapp.whatsappPhone}
                onChange={(e) =>
                  setWhatsapp({ ...whatsapp, whatsappPhone: e.target.value })
                }
                placeholder="+57 300 000 0000"
              />
              <div className="text-xs text-mute mt-1.5">
                Aquí te van a llegar los pedidos automáticamente.
              </div>
            </div>
            <div className="mt-4">
              <label className="label">Instagram (opcional)</label>
              <input
                className="input"
                value={whatsapp.instagramUrl}
                onChange={(e) =>
                  setWhatsapp({ ...whatsapp, instagramUrl: e.target.value })
                }
                placeholder="https://instagram.com/..."
              />
            </div>
            <div className="mt-4">
              <label className="label">Google Maps (opcional)</label>
              <input
                className="input"
                value={whatsapp.mapsUrl}
                onChange={(e) =>
                  setWhatsapp({ ...whatsapp, mapsUrl: e.target.value })
                }
                placeholder="https://maps.app.goo.gl/..."
              />
            </div>
          </Step>
        )}

        {step === 2 && (
          <Step
            title="Crea tu primera categoría"
            subtitle="Vas a agrupar tus productos en categorías como 'Bebidas' o 'Almuerzos'."
          >
            <div>
              <label className="label">Nombre de la categoría</label>
              <input
                className="input"
                value={category.name}
                onChange={(e) => setCategory({ name: e.target.value })}
                placeholder="Ej: Desayunos"
              />
            </div>
            <div className="card card-pad mt-4 bg-brand-soft border-brand/20">
              <div className="flex gap-3 items-start">
                <Icon name="spark" className="text-brand flex-none mt-0.5" />
                <div className="text-sm">
                  Más tarde podrás crear cuántas categorías quieras y reordenarlas.
                </div>
              </div>
            </div>
          </Step>
        )}

        {step === 3 && (
          <Step
            title="Agrega tu primer producto"
            subtitle="Empieza con uno. Si se vende en varios tamaños o presentaciones, agrégalos aquí mismo, cada uno con su precio."
          >
            <div>
              <label className="label">Nombre del producto</label>
              <input
                className="input"
                value={product.name}
                onChange={(e) =>
                  setProduct({ ...product, name: e.target.value })
                }
                placeholder="Ej: Capuchino"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div>
                <label className="label">Precio</label>
                {subsOn ? (
                  // Con subdivisiones activas el precio deja de ser un campo:
                  // lo definen ellas, y aquí se muestra lo que verá el cliente.
                  <div
                    className="input bg-bg2 text-mute flex items-center overflow-hidden whitespace-nowrap"
                    title="El precio lo definen las subdivisiones"
                  >
                    {subPreview ?? 'Según subdivisión'}
                  </div>
                ) : (
                  <input
                    type="number"
                    className="input"
                    value={product.basePrice}
                    onChange={(e) =>
                      setProduct({ ...product, basePrice: Number(e.target.value) })
                    }
                  />
                )}
              </div>
              <div>
                <label className="label">Descripción</label>
                <input
                  className="input"
                  value={product.description}
                  onChange={(e) =>
                    setProduct({ ...product, description: e.target.value })
                  }
                  placeholder="Opcional"
                />
              </div>
            </div>

            {/* Subdivisiones: mismo producto, varios tamaños/presentaciones
                con precio propio. Van al backend como ProductVariant con
                variantPriceMode='ABSOLUTE'. */}
            <div className="mt-4 border border-line rounded-lg p-3">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={subsOn}
                  onChange={toggleSubs}
                />
                <span>
                  <span className="font-semibold text-sm block">
                    Tiene subdivisiones con su propio precio
                  </span>
                  <span className="text-xs text-mute block mt-0.5">
                    Tamaños, presentaciones o porciones. Ej.: Torre pequeña
                    $34.900 · Torre personal $44.900.
                  </span>
                </span>
              </label>

              {subsOn && (
                <div className="mt-3">
                  <label className="label">Nombre del grupo</label>
                  <input
                    className="input"
                    value={subGroup}
                    onChange={(e) => setSubGroup(e.target.value)}
                    placeholder="Tamaño"
                  />
                  <div className="text-xs text-mute mt-1">
                    Es el título que verá tu cliente al elegir: «Tamaño»,
                    «Presentación», «Porción»…
                  </div>

                  <div className="mt-3 space-y-2">
                    {subRows.map((r, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          className="input flex-1 min-w-0"
                          placeholder={
                            i === 0
                              ? 'Ej: Pequeña'
                              : i === 1
                              ? 'Ej: Mediana'
                              : 'Ej: Grande'
                          }
                          value={r.name}
                          onChange={(e) => {
                            const arr = [...subRows];
                            arr[i] = { ...r, name: e.target.value };
                            setSubRows(arr);
                          }}
                        />
                        <input
                          type="text"
                          inputMode="decimal"
                          className="input w-28 flex-none"
                          placeholder="Precio"
                          value={r.price}
                          onChange={(e) => {
                            const arr = [...subRows];
                            arr[i] = { ...r, price: e.target.value };
                            setSubRows(arr);
                          }}
                        />
                        <button
                          type="button"
                          className="btn-danger flex-none px-3"
                          aria-label={`Eliminar subdivisión ${r.name || i + 1}`}
                          onClick={() => removeSubRow(i)}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="btn-ghost text-sm mt-2"
                    onClick={() =>
                      setSubRows([...subRows, { name: '', price: '' }])
                    }
                  >
                    + Agregar subdivisión
                  </button>

                  {/* Qué va a ver el cliente — que el negocio no lo descubra
                      después en su menú. */}
                  <div className="mt-3 rounded-lg bg-brand-soft border border-brand/20 px-3 py-2.5 text-xs leading-relaxed">
                    {subPreview ? (
                      <>
                        En tu menú,{' '}
                        <b>{product.name.trim() || 'este producto'}</b> se
                        mostrará con precio <b>{subPreview}</b>. Al pedirlo, tu
                        cliente elegirá una opción de «
                        {subGroup.trim() || 'Tamaño'}» y el pedido te llegará
                        con esa opción y su precio exacto.
                      </>
                    ) : (
                      <>
                        Completa nombre y precio de cada subdivisión para ver
                        aquí el precio que verá tu cliente.
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4">
              <label className="label">Foto del producto</label>
              <ImageUploader
                value={product.imageUrl}
                onChange={(url) => setProduct({ ...product, imageUrl: url })}
                folder="products"
              />
            </div>
          </Step>
        )}

        {step === 4 && (
          <Step
            title="Tu primera tarjeta de fidelización"
            subtitle="Cada vez que un cliente pida, le sumarás un sello automáticamente. Cuando complete X sellos, gana la recompensa."
          >
            <div>
              <label className="label">Nombre de la tarjeta</label>
              <input
                className="input"
                value={card.name}
                onChange={(e) => setCard({ ...card, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div>
                <label className="label">Sellos para recompensa</label>
                <input
                  type="number"
                  className="input"
                  min={3}
                  max={20}
                  value={card.stampsRequired}
                  onChange={(e) =>
                    setCard({ ...card, stampsRequired: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <label className="label">Recompensa</label>
                <input
                  className="input"
                  value={card.rewardText}
                  onChange={(e) =>
                    setCard({ ...card, rewardText: e.target.value })
                  }
                  placeholder="Ej: 1 café gratis"
                />
              </div>
            </div>

            {/* Preview iPhone-frame */}
            <div className="mt-6">
              <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-3">
                Así verá tu cliente su tarjeta en el teléfono
              </div>
              <div className="flex justify-center">
                <div className="iphone scale-90 origin-top">
                  <div className="iphone-notch" />
                  <div className="iphone-screen">
                    <div className="iphone-bar">
                      <span>9:41</span>
                      <span className="text-[10px]">●●● 100%</span>
                    </div>
                    <div className="wallet-actions">
                      <span className="wallet-ok">OK</span>
                      <span className="text-mute2 text-xs">↑ ···</span>
                    </div>
                    <div className="mx-2 mb-2">
                      <div
                        className="pass"
                        style={{
                          background: `linear-gradient(135deg, ${brand.primaryColor}, ${brand.secondaryColor})`,
                        }}
                      >
                        <div className="pass-head">
                          <div className="pass-logo">
                            <span className="pass-logo-mark">
                              {(brand.brandName[0] || 'C').toUpperCase()}
                            </span>{' '}
                            {brand.brandName || 'Tu marca'}
                          </div>
                          <div className="pass-side">
                            <div className="pass-side-lbl">SELLOS</div>
                            <div className="pass-side-val">3/{card.stampsRequired}</div>
                          </div>
                        </div>
                        <div
                          className="pass-strip"
                          style={{
                            background:
                              'linear-gradient(135deg,rgba(0,0,0,.15),rgba(0,0,0,.05))',
                          }}
                        >
                          <div className="strip-stamps">
                            {Array.from({ length: Math.min(card.stampsRequired, 7) }).map(
                              (_, i) => (
                                <div
                                  key={i}
                                  className={`strip-stamp ${i < 3 ? 'full' : ''}`}
                                  style={{
                                    color: i < 3 ? brand.primaryColor : '#fff',
                                  }}
                                >
                                  {i < 3 ? '✓' : ''}
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                        <div className="pass-fields">
                          <div>
                            <div className="pf-lbl">TITULAR</div>
                            <div className="pf-val">MARÍA PÉREZ</div>
                          </div>
                          <div className="text-right">
                            <div className="pf-lbl">RECOMPENSA</div>
                            <div className="pf-val text-xs">
                              {card.rewardText || '1 producto gratis'}
                            </div>
                          </div>
                        </div>
                        <div className="pass-bar">
                          <div className="w-40 h-12 bg-white/90 rounded grid place-items-center text-ink/80 text-[9px] tracking-widest">
                            ▮▯▮▮▯▮▯▮▮▯▮▮▯▮▯
                          </div>
                          <div className="pager">
                            <span className="pager-dot" />
                            <span className="pager-dot on" />
                            <span className="pager-dot" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Preview REAL — imagen PNG del generador de producción (Sharp),
                  la MISMA que el cliente recibe en su Wallet, en 3 estados. Si
                  el endpoint falla, el mock CSS de arriba queda como respaldo. */}
              <div className="mt-5">
                <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-2">
                  Imagen real del cartón (lo que llega a su Wallet)
                </div>
                <WalletStripRealPreview
                  config={{
                    primaryColor: brand.primaryColor,
                    secondaryColor: brand.secondaryColor,
                    stampsRequired: card.stampsRequired,
                  }}
                />
              </div>
            </div>
          </Step>
        )}

        {step === 5 && (
          <Step
            title={
              <span className="inline-flex items-center gap-2">
                <span className="inline-block animate-bounce-once">🎉</span>
                <span>¡Listo, {brand.brandName}!</span>
              </span>
            }
            subtitle="Ya estás en línea. Tu cuenta está activa y todo el panel desbloqueado. Cancela cuando quieras desde tu panel."
          >
            <div className="grid md:grid-cols-2 gap-4">
              {/* Mini-sitio público */}
              <div className="card card-pad">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-brand-soft text-brand-700 flex items-center justify-center">
                    <Icon name="store" size={16} />
                  </div>
                  <div className="font-semibold">Tu mini-sitio</div>
                </div>
                <div className="font-mono text-xs break-all bg-bg2 px-3 py-2.5 rounded-lg text-ink/80">
                  {typeof window !== 'undefined' ? window.location.origin : ''}/m/{tenant.slug}
                </div>
                <Link
                  href={`/m/${tenant.slug}`}
                  target="_blank"
                  className="btn-ghost w-full justify-center mt-3 text-sm"
                >
                  Abrir sitio →
                </Link>
              </div>

              {/* Tarjeta wallet emitida */}
              {demoPass && (
                <div className="card card-pad">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 rounded-lg bg-brand-soft text-brand-700 flex items-center justify-center">
                      <Icon name="card" size={16} />
                    </div>
                    <div className="font-semibold">Tu tarjeta de prueba</div>
                  </div>
                  <p className="text-xs text-mute mb-3">
                    Te emitimos una tarjeta a tu nombre para que la pruebes en
                    tu teléfono. Escanea el QR con la cámara y la guardas en
                    Google Wallet.
                  </p>
                  <div className="bg-white p-3 rounded-lg flex justify-center">
                    <img
                      alt="QR de tu tarjeta"
                      width={140}
                      height={140}
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&margin=0&data=${encodeURIComponent(demoPass.walletUrl)}`}
                    />
                  </div>
                  <a
                    href={demoPass.walletUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-primary w-full justify-center mt-3 text-sm"
                  >
                    Abrir mi tarjeta →
                  </a>
                </div>
              )}
            </div>

            <div className="text-xs uppercase tracking-wider text-mute font-semibold mt-6 mb-2">
              Próximos pasos
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Link href="/app" className="card card-pad text-center hover:shadow-md transition">
                <Icon name="grid" className="mx-auto text-brand mb-2" size={20} />
                <div className="font-semibold text-sm">Ir al dashboard</div>
                <div className="text-xs text-mute mt-1">Métricas y atajos</div>
              </Link>
              <Link href="/app/menu" className="card card-pad text-center hover:shadow-md transition">
                <Icon name="menu" className="mx-auto text-brand mb-2" size={20} />
                <div className="font-semibold text-sm">Agregar más productos</div>
                <div className="text-xs text-mute mt-1">Crece tu menú</div>
              </Link>
              <Link href="/app/storefront" className="card card-pad text-center hover:shadow-md transition">
                <Icon name="store" className="mx-auto text-brand mb-2" size={20} />
                <div className="font-semibold text-sm">Personalizar mi sitio</div>
                <div className="text-xs text-mute mt-1">Bloques y diseño</div>
              </Link>
              <Link href="/app/automations" className="card card-pad text-center hover:shadow-md transition">
                <Icon name="spark" className="mx-auto text-brand mb-2" size={20} />
                <div className="font-semibold text-sm">Activar automatizaciones</div>
                <div className="text-xs text-mute mt-1">Mensajes automáticos</div>
              </Link>
            </div>
          </Step>
        )}

        {err && (
          <div className="rounded-lg bg-bad-soft px-3 py-2.5 text-sm text-bad-ink mt-4">
            {err}
          </div>
        )}

        {/* Navigation */}
        {step < 5 && (
          <div className="mt-8 flex items-center justify-between">
            <button
              onClick={() => setStep(Math.max(0, step - 1))}
              disabled={step === 0}
              className="btn-ghost disabled:opacity-50"
            >
              ← Atrás
            </button>
            <button
              className="btn-primary"
              onClick={next}
              disabled={busy || (step === 0 && !brand.brandName)}
            >
              {busy
                ? 'Guardando…'
                : step === 4
                ? 'Crear y terminar'
                : 'Siguiente →'}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function Step({
  title,
  subtitle,
  children,
}: {
  title: React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      {subtitle && (
        <p className="text-mute mt-2 leading-relaxed max-w-lg">{subtitle}</p>
      )}
      <div className="mt-6 card card-pad">{children}</div>
    </div>
  );
}

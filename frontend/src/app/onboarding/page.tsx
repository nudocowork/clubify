'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, getUser } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { ImageUploader } from '@/components/ImageUploader';

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
    primaryColor: '#6366F1',
    secondaryColor: '#C026D3',
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
  const [card, setCard] = useState({
    name: '',
    rewardText: '',
    stampsRequired: 10,
  });

  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.push('/login');
      return;
    }
    if (u.role === 'SUPER_ADMIN') {
      router.push('/admin');
      return;
    }
    api('/tenants/me').then((t: any) => {
      setTenant(t);
      setBrand({
        brandName: t.brandName || '',
        logoUrl: t.logoUrl,
        primaryColor: t.primaryColor || '#6366F1',
        secondaryColor: t.secondaryColor || '#C026D3',
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
    });
  }, [router]);

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
        case 3: // Producto
          await api('/catalog/products', {
            method: 'POST',
            body: JSON.stringify({
              ...product,
              categoryId: tenant.firstCategoryId,
            }),
          });
          break;
        case 4: // Tarjeta
          await api('/cards', {
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
    router.push('/app');
  }

  if (!tenant) return <div className="p-8 text-mute">Cargando…</div>;

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
        <div className="flex justify-between text-[10px] uppercase tracking-wider text-mute font-semibold">
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
                Acá te van a llegar los pedidos automáticamente.
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
            subtitle="Empieza con uno. Después puedes agregar variantes (tamaños) y extras."
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
                <input
                  type="number"
                  className="input"
                  value={product.basePrice}
                  onChange={(e) =>
                    setProduct({ ...product, basePrice: Number(e.target.value) })
                  }
                />
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

            {/* Preview */}
            <div className="mt-6">
              <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-2">
                Así verán tus clientes su tarjeta
              </div>
              <div
                className="rounded-2xl p-5 text-white max-w-xs"
                style={{
                  background: `linear-gradient(135deg, ${brand.primaryColor}, ${brand.secondaryColor})`,
                }}
              >
                <div className="text-xs uppercase tracking-wider opacity-85">
                  STAMPS
                </div>
                <div className="font-semibold text-lg mt-1">{card.name}</div>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {Array.from({ length: card.stampsRequired }).map((_, i) => (
                    <span
                      key={i}
                      className="w-5 h-5 rounded-full border-2 border-white/50"
                    />
                  ))}
                </div>
                <div className="text-xs uppercase tracking-wider opacity-70 mt-4">
                  Recompensa
                </div>
                <div className="text-sm">{card.rewardText}</div>
              </div>
            </div>
          </Step>
        )}

        {step === 5 && (
          <Step
            title="¡Listo! 🎉"
            subtitle={`${brand.brandName} ya está en línea. Comparte tu link o QR para que tus clientes empiecen a pedir.`}
          >
            <div className="card card-pad text-center">
              <div className="text-xs uppercase tracking-wider text-mute font-semibold mb-2">
                Tu mini-sitio público
              </div>
              <div className="font-mono text-sm break-all bg-bg2 px-3 py-2.5 rounded-lg">
                {typeof window !== 'undefined' ? window.location.origin : ''}/m/{tenant.slug}
              </div>
              <div className="mt-4 flex gap-2 justify-center">
                <Link
                  href={`/m/${tenant.slug}`}
                  target="_blank"
                  className="btn-ghost"
                >
                  <Icon name="arrow-right" /> Abrir sitio
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-5">
              <Link href="/app" className="card card-pad text-center hover:shadow-md2 transition">
                <Icon name="grid" className="mx-auto text-brand mb-2" size={24} />
                <div className="font-semibold">Ir al dashboard</div>
                <div className="text-xs text-mute mt-1">Métricas y atajos</div>
              </Link>
              <Link href="/app/menu" className="card card-pad text-center hover:shadow-md2 transition">
                <Icon name="menu" className="mx-auto text-brand mb-2" size={24} />
                <div className="font-semibold">Agregar más productos</div>
                <div className="text-xs text-mute mt-1">Crece tu menú</div>
              </Link>
              <Link href="/app/storefront" className="card card-pad text-center hover:shadow-md2 transition">
                <Icon name="store" className="mx-auto text-brand mb-2" size={24} />
                <div className="font-semibold">Personalizar mi sitio</div>
                <div className="text-xs text-mute mt-1">Bloques y diseño</div>
              </Link>
              <Link href="/app/automations" className="card card-pad text-center hover:shadow-md2 transition">
                <Icon name="spark" className="mx-auto text-brand mb-2" size={24} />
                <div className="font-semibold">Activar automatizaciones</div>
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
  title: string;
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

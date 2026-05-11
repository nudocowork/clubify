// Preview público del strip de sellos rediseñado en WalletPassPreview.
// Muestra varios estados (vacío → completo) y colores de marca para
// validar el look premium tipo Starbucks/Apple Wallet.

import { WalletPassPreview } from '@/components/WalletPassPreview';

type Variant = {
  title: string;
  subtitle: string;
  primary: string;
  secondary: string;
  icon: string;
  required: number;
  current: number;
  brand: string;
};

const VARIANTS: Variant[] = [
  {
    title: 'Vacío',
    subtitle: '0 / 10 sellos',
    primary: '#16A34A',
    secondary: '#22C55E',
    icon: '🍪',
    required: 10,
    current: 0,
    brand: 'Café del Día',
  },
  {
    title: 'Inicio',
    subtitle: '3 / 10 sellos',
    primary: '#16A34A',
    secondary: '#22C55E',
    icon: '🍪',
    required: 10,
    current: 3,
    brand: 'Café del Día',
  },
  {
    title: 'A mitad',
    subtitle: '5 / 10 sellos',
    primary: '#16A34A',
    secondary: '#4ADE80',
    icon: '🍪',
    required: 10,
    current: 5,
    brand: 'Café del Día',
  },
  {
    title: 'Casi listo',
    subtitle: '8 / 10 sellos',
    primary: '#15803D',
    secondary: '#22C55E',
    icon: '🍪',
    required: 10,
    current: 8,
    brand: 'Café del Día',
  },
  {
    title: 'Completo',
    subtitle: '10 / 10 sellos',
    primary: '#166534',
    secondary: '#16A34A',
    icon: '🍪',
    required: 10,
    current: 10,
    brand: 'Café del Día',
  },
  {
    title: 'Marca azul',
    subtitle: '4 / 8 sellos',
    primary: '#1D4ED8',
    secondary: '#3B82F6',
    icon: '⭐',
    required: 8,
    current: 4,
    brand: 'NudoCowork',
  },
  {
    title: 'Marca rosa',
    subtitle: '6 / 12 sellos',
    primary: '#BE185D',
    secondary: '#EC4899',
    icon: '🧁',
    required: 12,
    current: 6,
    brand: 'Postres Lola',
  },
  {
    title: 'Marca dark',
    subtitle: '2 / 6 sellos',
    primary: '#0F172A',
    secondary: '#475569',
    icon: '👑',
    required: 6,
    current: 2,
    brand: 'Black Card',
  },
];

export default function WalletStampsPreviewPage() {
  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <header className="mb-8">
          <div className="text-[11px] tracking-[0.2em] uppercase text-mute font-semibold">
            Preview
          </div>
          <h1 className="text-2xl font-bold mt-1">
            Wallet — Strip de sellos rediseñado
          </h1>
          <p className="text-sm text-mute mt-2 max-w-2xl leading-relaxed">
            Look premium tipo Starbucks / Apple Wallet. Completos = círculo
            blanco sólido con ícono en color de marca. Vacíos = relleno sutil
            sin borde marcado. Fondo gradiente del pase respira a través del
            strip.
          </p>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {VARIANTS.map((v) => (
            <div key={v.title} className="space-y-3">
              <div>
                <div className="font-semibold text-sm">{v.title}</div>
                <div className="text-xs text-mute">{v.subtitle}</div>
              </div>
              <WalletPassPreview
                brandName={v.brand}
                primaryColor={v.primary}
                secondaryColor={v.secondary}
                cardName={v.brand}
                cardType="STAMPS"
                stampsRequired={v.required}
                stampsCount={v.current}
                stampIcon={v.icon}
                rewardText="1 producto gratis"
                customerName="JHON ARIAS"
                size="md"
              />
            </div>
          ))}
        </div>

        <section className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="card card-pad">
            <h3 className="font-semibold mb-3">✓ Cumple el brief</h3>
            <ul className="text-sm space-y-1.5 text-mute">
              <li>• Primer sello completo = círculo blanco sólido con ícono</li>
              <li>• Vacíos = relleno sutil sin borde marcado</li>
              <li>• Alineación horizontal perfecta (flex row)</li>
              <li>• Espaciado consistente entre sellos</li>
              <li>• Fondo gradiente del pase visible (sin overlay opaco)</li>
              <li>• Altura del strip ≈ 64px (rango 56-72px)</li>
              <li>• Sombra y gloss interno para look premium</li>
            </ul>
          </div>
          <div className="card card-pad">
            <h3 className="font-semibold mb-3">Notas técnicas</h3>
            <ul className="text-sm space-y-1.5 text-mute">
              <li>• <code>stampActiveColor</code> custom sigue funcionando</li>
              <li>• <code>stampContourColor</code> sólo se renderiza si el tenant lo configura</li>
              <li>• <code>centerBgColor</code> custom respeta degradado</li>
              <li>• Tamaño de círculo responsive: 40px (≤8) / 32px (>8)</li>
              <li>• Ícono responsive: 17px (≤8) / 13px (>8)</li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

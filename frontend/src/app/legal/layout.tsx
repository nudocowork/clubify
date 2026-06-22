import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { resolveLegalBrand } from '@/lib/legal-brand';

export default async function LegalLayout({ children }: { children: React.ReactNode }) {
  const brand = await resolveLegalBrand();
  return (
    <main className="min-h-screen bg-bg">
      <header className="border-b border-line bg-white px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center" aria-label={brand.brandName}>
            {brand.logoUrl ? (
              <img
                src={brand.logoUrl}
                alt={brand.brandName}
                className="h-8 w-auto max-w-[160px] object-contain"
              />
            ) : (
              <Logo size={32} />
            )}
          </Link>
          <Link href="/" className="text-sm text-mute hover:text-ink">
            ← Volver al inicio
          </Link>
        </div>
      </header>
      <article className="max-w-3xl mx-auto px-6 py-12 prose prose-sm">
        {children}
      </article>
      <footer className="border-t border-line py-8 text-center text-xs text-mute">
        © 2025 {brand.brandName} ·{' '}
        <Link href="/legal/terms" className="hover:text-ink">
          Términos
        </Link>{' '}
        ·{' '}
        <Link href="/legal/privacy" className="hover:text-ink">
          Privacidad
        </Link>
      </footer>
    </main>
  );
}

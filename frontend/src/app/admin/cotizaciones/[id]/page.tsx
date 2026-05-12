'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { QuotePreviewPremium } from '@/components/QuotePreviewPremium';
import { DownloadQuotePDFButton } from '@/components/DownloadQuotePDFButton';
import { ShareQuoteButtons } from '@/components/ShareQuoteButtons';
import {
  getQuoteTemplateBySlug,
  QUOTE_TEMPLATES,
  type QuoteTemplate,
} from '@/lib/quote-templates';
import type { QuotePlan } from '@/lib/quote-benefits';

type Quote = {
  id: string;
  publicToken: string;
  customerName: string;
  businessName: string;
  phone: string | null;
  email: string | null;
  plan: QuotePlan;
  templateSlug: string | null;
  advisorId: string | null;
  advisorName: string;
  priceSnapshot: string;
  currencySnapshot: string;
  pdfDownloadCount?: number;
  lastPdfDownloadAt?: string | null;
  viewCount?: number;
  firstViewedAt?: string | null;
  lastViewedAt?: string | null;
  ctaClickCount?: number;
  firstCtaClickedAt?: string | null;
  lastCtaClickedAt?: string | null;
  convertedAt?: string | null;
  convertedToTenantId?: string | null;
  convertedToTenant?: { id: string; slug: string; brandName: string } | null;
  createdAt: string;
};

// Plantilla de fallback si templateSlug es null o no matchea.
const FALLBACK_TEMPLATE: QuoteTemplate =
  QUOTE_TEMPLATES.find((t) => t.slug === 'other')!;

export default function CotizacionDetallePage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params?.id ?? '');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setQuote(await api<Quote>(`/admin/quotes/${id}`));
    } catch (e: any) {
      toast(e.message || 'No se encontró la cotización', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function remove() {
    if (!quote) return;
    if (
      !confirm(
        `¿Eliminar cotización de ${quote.customerName} (${quote.businessName})?`,
      )
    )
      return;
    setDeleting(true);
    try {
      await api(`/admin/quotes/${quote.id}`, { method: 'DELETE' });
      toast('Cotización eliminada', 'success');
      router.push('/admin/cotizaciones');
    } catch (e: any) {
      toast(e.message || 'No se pudo eliminar', 'error');
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="card card-pad">
        <div className="h-4 bg-bg2 rounded animate-shimmer mb-3" />
        <div className="h-64 bg-bg2 rounded animate-shimmer" />
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="card card-pad text-center">
        <p className="text-sm text-mute">Cotización no encontrada.</p>
        <Link className="btn-primary mt-4" href="/admin/cotizaciones">
          Volver al listado
        </Link>
      </div>
    );
  }

  const template =
    getQuoteTemplateBySlug(quote.templateSlug) ?? FALLBACK_TEMPLATE;
  const price = Number(quote.priceSnapshot);

  const downloadCount = quote.pdfDownloadCount ?? 0;
  const viewCount = quote.viewCount ?? 0;
  const downloadButtonProps = {
    quoteId: quote.id,
    onDownloaded: load,
    customerName: quote.customerName,
    businessName: quote.businessName,
    phone: quote.phone,
    email: quote.email,
    plan: quote.plan,
    template,
    price,
    currency: quote.currencySnapshot,
    advisorName: quote.advisorName,
    date: new Date(quote.createdAt),
  };

  return (
    <div className="pb-20 lg:pb-0">
      <div className="page-head">
        <h1 className="page-title">
          {quote.businessName}{' '}
          <span className="page-crumb">
            / Cotización · {quote.plan === 'PRO' ? 'Pro' : 'Elite'}
            {quote.convertedAt && (
              <span
                className="ml-2 text-ok-ink bg-ok-soft px-2 py-0.5 rounded font-semibold"
                title={`Convertido ${new Date(quote.convertedAt).toLocaleString('es-CO')}`}
              >
                ✅ Convertido
              </span>
            )}
            {viewCount > 0 && (
              <span
                className="ml-2 text-emerald-700 font-semibold"
                title={
                  quote.lastViewedAt
                    ? `Última vista: ${new Date(quote.lastViewedAt).toLocaleString('es-CO')}`
                    : undefined
                }
              >
                👁 {viewCount}
              </span>
            )}
            {(quote.ctaClickCount ?? 0) > 0 && (
              <span
                className="ml-2 text-orange-600 font-semibold"
                title={
                  quote.lastCtaClickedAt
                    ? `Último click "Aceptar plan": ${new Date(quote.lastCtaClickedAt).toLocaleString('es-CO')}`
                    : undefined
                }
              >
                🔥 {quote.ctaClickCount}
              </span>
            )}
            {downloadCount > 0 && (
              <span
                className="ml-2 text-brand-700 font-semibold"
                title={
                  quote.lastPdfDownloadAt
                    ? `Última descarga: ${new Date(quote.lastPdfDownloadAt).toLocaleString('es-CO')}`
                    : undefined
                }
              >
                ↓ {downloadCount}
              </span>
            )}
          </span>
        </h1>
        <div className="flex gap-2 flex-wrap">
          <Link className="btn-ghost" href="/admin/cotizaciones">
            <span
              className="inline-block"
              style={{ transform: 'scaleX(-1)' }}
            >
              <Icon name="arrow-right" />
            </span>
            Volver
          </Link>
          <button
            className="btn-ghost text-bad"
            onClick={remove}
            disabled={deleting}
          >
            <Icon name="trash" /> Eliminar
          </button>
          {/* En desktop el botón vive en el header. En mobile aparece sticky abajo (ver más abajo). */}
          <div className="hidden lg:inline-flex">
            <DownloadQuotePDFButton {...downloadButtonProps} />
          </div>
        </div>
      </div>

      {quote.convertedAt && quote.convertedToTenant && (
        <div className="mb-4 rounded-card bg-ok-soft border border-ok/30 px-4 py-3 flex items-center gap-3">
          <span className="text-2xl" aria-hidden>
            ✅
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-ok-ink">
              Esta cotización fue convertida en cuenta
            </div>
            <div className="text-xs text-ok-ink/80">
              {new Date(quote.convertedAt).toLocaleString('es-CO')} ·{' '}
              <Link
                href={`/admin/tenants/${quote.convertedToTenant.id}`}
                className="underline font-medium hover:text-ink"
              >
                {quote.convertedToTenant.brandName} ({quote.convertedToTenant.slug})
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Compartir el link de la vista pública con el cliente. Si todavía
          no fue convertida es la acción principal post-creación; si ya
          se convirtió igual queda visible por si quieren reenviarla. */}
      <div className="mb-4">
        <ShareQuoteButtons
          variant="card"
          publicToken={quote.publicToken}
          customerName={quote.customerName}
          businessName={quote.businessName}
          customerPhone={quote.phone}
          customerEmail={quote.email}
          planLabel={quote.plan === 'PRO' ? 'Pro' : 'Elite'}
        />
      </div>

      <QuotePreviewPremium
        customerName={quote.customerName}
        businessName={quote.businessName}
        phone={quote.phone || undefined}
        email={quote.email || undefined}
        plan={quote.plan}
        template={template}
        price={price}
        currency={quote.currencySnapshot}
        advisorName={quote.advisorName}
        date={new Date(quote.createdAt)}
      />

      {/* Sticky bottom bar mobile — el botón principal queda siempre alcanzable
          al scrollear el preview largo */}
      <div
        className="fixed bottom-0 left-0 right-0 z-30 lg:hidden bg-surface border-t border-line px-4 py-3 shadow-md2"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}
      >
        <DownloadQuotePDFButton
          {...downloadButtonProps}
          className="btn-primary w-full justify-center"
        />
      </div>
    </div>
  );
}

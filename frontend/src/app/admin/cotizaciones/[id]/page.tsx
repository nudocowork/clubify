'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { toast } from '@/components/Toast';
import { QuotePreviewPremium } from '@/components/QuotePreviewPremium';
import { DownloadQuotePDFButton } from '@/components/DownloadQuotePDFButton';
import {
  getQuoteTemplateBySlug,
  QUOTE_TEMPLATES,
  type QuoteTemplate,
} from '@/lib/quote-templates';
import type { QuotePlan } from '@/lib/quote-benefits';

type Quote = {
  id: string;
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

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {quote.businessName}{' '}
          <span className="page-crumb">
            / Cotización · {quote.plan === 'PRO' ? 'Pro' : 'Elite'}
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
          <DownloadQuotePDFButton
            customerName={quote.customerName}
            businessName={quote.businessName}
            phone={quote.phone}
            email={quote.email}
            plan={quote.plan}
            template={template}
            price={price}
            currency={quote.currencySnapshot}
            advisorName={quote.advisorName}
            date={new Date(quote.createdAt)}
          />
        </div>
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
    </div>
  );
}

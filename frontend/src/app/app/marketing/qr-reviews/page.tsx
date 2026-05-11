'use client';
import Link from 'next/link';
import { UnderConstruction } from '@/components/UnderConstruction';

export default function QrReviewsPage() {
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/app/marketing" className="text-mute hover:text-ink">
            Marketing
          </Link>{' '}
          <span className="page-crumb">/ QR Reseñas</span>
        </h1>
      </div>
      <UnderConstruction
        title="QR Reseñas — próximamente"
        description="Constructor visual de carteles, stickers, acrílicos y flyers para incentivar reseñas de Google. Usa automáticamente el QR del filtro inteligente de 4-5★."
      />
    </div>
  );
}

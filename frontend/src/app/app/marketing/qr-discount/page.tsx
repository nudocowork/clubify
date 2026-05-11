'use client';
import Link from 'next/link';
import { UnderConstruction } from '@/components/UnderConstruction';

export default function QrDiscountPage() {
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/app/marketing" className="text-mute hover:text-ink">
            Marketing
          </Link>{' '}
          <span className="page-crumb">/ QR Descuento</span>
        </h1>
      </div>
      <UnderConstruction
        title="QR Descuento — próximamente"
        description="Cartel promocional pequeño con constructor visual editable. Pensado para promociones, descuentos, primera compra y activaciones de campaña."
      />
    </div>
  );
}

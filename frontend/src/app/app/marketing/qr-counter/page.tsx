'use client';
import Link from 'next/link';
import { UnderConstruction } from '@/components/UnderConstruction';

export default function QrCounterPage() {
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          <Link href="/app/marketing" className="text-mute hover:text-ink">
            Marketing
          </Link>{' '}
          <span className="page-crumb">/ QR Mostrador</span>
        </h1>
      </div>
      <UnderConstruction
        title="QR Mostrador — próximamente"
        description="Cartel de mostrador con constructor visual editable. Diseño vertical, horizontal, circular, mesa y acrílico. El cliente escanea, instala su wallet y accede a promociones y fidelización."
      />
    </div>
  );
}

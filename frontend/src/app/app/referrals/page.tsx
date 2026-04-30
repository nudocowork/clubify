'use client';
import Link from 'next/link';
import { Icon } from '@/components/Icon';

export default function TenantReferrals() {
  return (
    <div className="max-w-2xl">
      <div className="page-head">
        <h1 className="page-title">Programa de referidos</h1>
      </div>
      <div className="card card-pad">
        <p className="text-mute leading-relaxed">
          ¿Conoces otro negocio al que le sirva Clubify? Genera tu código de
          referido y gana <strong className="text-brand">comisión</strong> cuando se
          convierta en cliente pago.
        </p>
        <Link href="/refer" className="btn-primary mt-5">
          <Icon name="spark" /> Generar código de referido
        </Link>
      </div>
    </div>
  );
}

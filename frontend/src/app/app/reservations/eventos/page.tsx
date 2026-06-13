'use client';
import Link from 'next/link';
import { fmtLongDate, todayISO } from '../_shared';

export default function EventosPage() {
  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="page-title m-0">
            Eventos <span className="page-crumb text-mute font-normal">/ {fmtLongDate(todayISO())}</span>
          </h1>
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-ok-soft text-ok-ink text-xs font-semibold">
          <span className="relative inline-block w-2 h-2">
            <span className="absolute inset-0 rounded-full bg-ok animate-ping opacity-75" />
            <span className="absolute inset-0 rounded-full bg-ok" />
          </span>
          Tiempo real
        </div>
      </div>

      <div className="card card-pad max-w-2xl mx-auto text-center py-12">
        <div
          className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center text-2xl mb-4"
          style={{ background: 'rgba(34,197,94,0.15)' }}
        >
          ✨
        </div>
        <h2 className="text-lg font-bold m-0">Eventos y experiencias</h2>
        <p className="text-sm text-mute mt-2 max-w-md mx-auto leading-relaxed">
          Catas, conciertos, cenas especiales y eventos privados con cupos, horarios y control de
          asistentes. Reutiliza el motor de reservas y los avisos al negocio.
        </p>
        <p className="text-xs text-mute italic mt-4">Próximamente — Fase 3 del módulo.</p>
        <Link
          href="/app/reservations"
          className="inline-block mt-5 btn-primary text-sm px-5"
        >
          Volver a la agenda
        </Link>
      </div>
    </div>
  );
}

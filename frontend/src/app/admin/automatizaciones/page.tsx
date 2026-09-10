'use client';
import { useState } from 'react';
import AutomatizacionesPanel from '@/components/AutomatizacionesPanel';
import BrandWorkflowsPanel from '@/components/BrandWorkflowsPanel';
import WhatsAppQrPanel from '@/components/WhatsAppQrPanel';
import EmailMarketingPanel from '@/components/EmailMarketingPanel';
import EmailMarketingWorkflows from '@/components/EmailMarketingWorkflows';

export default function AutomatizacionesPage() {
  // «Workflows» son los de NEGOCIOS; «Flujos de contactos» los de PERSONAS.
  // Son dos motores distintos y esa distinción no estaba en ninguna parte: el
  // segundo constructor llevaba meses construido y sin enganchar a ninguna
  // pantalla, con 192 contactos en la base y CERO inscripciones de todos los
  // tiempos. Se descubrió al cablear los disparadores de ventas, que van por
  // ahí — un lead es una persona, no un negocio.
  const [tab, setTab] = useState<
    'mensajes' | 'workflows' | 'contactos' | 'email' | 'qr'
  >('mensajes');
  return (
    <div>
      <div className="flex items-center gap-1 mb-4 rounded-lg border border-slate-200 bg-white p-1 text-sm w-fit">
        <button
          onClick={() => setTab('mensajes')}
          className="rounded-md px-3 py-1 font-medium"
          style={tab === 'mensajes' ? { background: '#16a34a', color: 'white' } : { color: '#64748b' }}
        >
          Mensajes automáticos
        </button>
        <button
          onClick={() => setTab('workflows')}
          className="rounded-md px-3 py-1 font-medium"
          style={tab === 'workflows' ? { background: '#16a34a', color: 'white' } : { color: '#64748b' }}
        >
          🔀 Workflows
        </button>
        <button
          onClick={() => setTab('contactos')}
          className="rounded-md px-3 py-1 font-medium"
          style={tab === 'contactos' ? { background: '#16a34a', color: 'white' } : { color: '#64748b' }}
        >
          👥 Flujos de contactos
        </button>
        <button
          onClick={() => setTab('email')}
          className="rounded-md px-3 py-1 font-medium"
          style={tab === 'email' ? { background: '#16a34a', color: 'white' } : { color: '#64748b' }}
        >
          📧 Email Marketing
        </button>
        <button
          onClick={() => setTab('qr')}
          className="rounded-md px-3 py-1 font-medium"
          style={tab === 'qr' ? { background: '#16a34a', color: 'white' } : { color: '#64748b' }}
        >
          📱 QR WhatsApp
        </button>
      </div>
      {tab === 'mensajes' ? (
        <AutomatizacionesPanel />
      ) : tab === 'workflows' ? (
        <BrandWorkflowsPanel />
      ) : tab === 'contactos' ? (
        <EmailMarketingWorkflows />
      ) : tab === 'email' ? (
        <EmailMarketingPanel />
      ) : (
        <WhatsAppQrPanel />
      )}
    </div>
  );
}

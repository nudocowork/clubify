'use client';
import { useState } from 'react';
import AutomatizacionesPanel from '@/components/AutomatizacionesPanel';
import BrandWorkflowsPanel from '@/components/BrandWorkflowsPanel';
import WhatsAppQrPanel from '@/components/WhatsAppQrPanel';
import EmailMarketingPanel from '@/components/EmailMarketingPanel';

export default function AutomatizacionesPage() {
  const [tab, setTab] = useState<'mensajes' | 'workflows' | 'email' | 'qr'>('mensajes');
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
      ) : tab === 'email' ? (
        <EmailMarketingPanel />
      ) : (
        <WhatsAppQrPanel />
      )}
    </div>
  );
}

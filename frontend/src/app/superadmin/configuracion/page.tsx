'use client';

export default function ConfiguracionPage() {
  return (
    <div>
      <h1 className="m-0" style={{ fontSize: 26, fontWeight: 800, color: '#16241c', letterSpacing: -0.6 }}>
        Configuración
      </h1>
      <p className="text-sm mt-1 mb-5" style={{ color: '#6b7785' }}>
        Ajustes globales de la plataforma: nombre, branding, política de créditos, períodos de gracia.
      </p>

      <div className="grid md:grid-cols-2 gap-4">
        <div
          className="rounded-[14px] p-10 text-center"
          style={{
            background: 'white',
            border: '1px solid #e7e9ec',
            boxShadow: '0 1px 2px rgba(16,24,40,.04)',
          }}
        >
          <div
            className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center text-2xl mb-3"
            style={{ background: '#f0fdf4', color: '#15803d' }}
          >
            ⚙
          </div>
          <h2 className="m-0" style={{ fontSize: 18, fontWeight: 800, color: '#16241c' }}>
            Próximamente
          </h2>
          <p className="text-sm mt-2 max-w-sm mx-auto" style={{ color: '#6b7785' }}>
            Configuración de plataforma: nombre comercial, logo, paleta de colores, días de gracia,
            política de cancelación de créditos.
          </p>
        </div>

        <div
          className="rounded-[14px] p-10 text-center"
          style={{
            background: 'white',
            border: '1px solid #e7e9ec',
            boxShadow: '0 1px 2px rgba(16,24,40,.04)',
          }}
        >
          <div
            className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center text-2xl mb-3"
            style={{ background: '#eff6ff', color: '#1e40af' }}
          >
            👤
          </div>
          <h2 className="m-0" style={{ fontSize: 18, fontWeight: 800, color: '#16241c' }}>
            Administradores
          </h2>
          <p className="text-sm mt-2 max-w-sm mx-auto" style={{ color: '#6b7785' }}>
            Invitar otros usuarios con rol <strong>PLATFORM_OWNER</strong> para gestionar la
            plataforma. Funcionalidad pendiente.
          </p>
        </div>
      </div>
    </div>
  );
}

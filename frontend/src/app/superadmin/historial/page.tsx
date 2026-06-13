'use client';

export default function HistorialPage() {
  return (
    <div>
      <h1 className="m-0" style={{ fontSize: 26, fontWeight: 800, color: '#16241c', letterSpacing: -0.6 }}>
        Historial
      </h1>
      <p className="text-sm mt-1 mb-5" style={{ color: '#6b7785' }}>
        Bitácora de eventos de la plataforma: creaciones de marca, ajustes de créditos,
        suspensiones, conexiones de integraciones.
      </p>

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
          🕒
        </div>
        <h2 className="m-0" style={{ fontSize: 18, fontWeight: 800, color: '#16241c' }}>
          Próximamente
        </h2>
        <p className="text-sm mt-2 max-w-md mx-auto" style={{ color: '#6b7785' }}>
          Timeline filtrable de acciones del Super Admin con búsqueda por marca, fecha y tipo
          de evento. Pendiente de definición con el cliente.
        </p>
      </div>
    </div>
  );
}

/**
 * Lo que ve el cliente si el enlace corto del QR no se pudo resolver a tiempo
 * (backend lento o reiniciando): un mensaje y «Reintentar», en vez de una
 * pantalla en blanco o un falso «no existe». Sin JavaScript: el botón es un
 * enlace a la misma dirección, así funciona en cualquier navegador.
 */
export function ReintentarEnlace({ href }: { href: string }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: '#FFFFFF',
        fontFamily: 'Inter, system-ui, sans-serif',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 360 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, color: '#0A0A0A' }}>
          No pudimos cargar esta página
        </h1>
        <p style={{ fontSize: 14, color: '#6B7280', marginTop: 8 }}>
          Revisa tu conexión e inténtalo otra vez.
        </p>
        <a
          href={href}
          style={{
            display: 'inline-block',
            marginTop: 16,
            padding: '10px 20px',
            borderRadius: 999,
            background: '#0A0A0A',
            color: '#FFFFFF',
            fontWeight: 600,
            fontSize: 14,
            textDecoration: 'none',
          }}
        >
          Reintentar
        </a>
      </div>
    </div>
  );
}

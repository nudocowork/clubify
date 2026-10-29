import { resolveLegalBrand } from '@/lib/legal-brand';

export const metadata = {
  title: 'Política de privacidad',
};

export default async function PrivacyPage() {
  const brand = await resolveLegalBrand();
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight mb-1">Política de privacidad</h1>
      <p className="text-sm text-mute">Última actualización: octubre 2026</p>

      <section className="mt-8 space-y-5 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold mt-6">Datos que recopilamos</h2>
        <p>Cuando usas {brand.brandName} recopilamos:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <b>De ti (dueño del negocio):</b> nombre, email, teléfono,
            información de tu negocio (nombre comercial, logo, redes sociales),
            datos de facturación procesados por {brand.paymentProvider}.
          </li>
          <li>
            <b>De tus clientes finales:</b> nombre, teléfono, email opcional,
            historial de pedidos y sellos. Estos datos te pertenecen y los
            usamos solo para operar el servicio que les das.
          </li>
          <li>
            <b>Datos técnicos:</b> dirección IP, tipo de dispositivo,
            navegador, logs de actividad para mejorar el servicio y prevenir
            fraude.
          </li>
        </ul>

        <h2 className="text-lg font-semibold mt-6">Cómo usamos los datos</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Operar y mantener el servicio</li>
          <li>Enviar emails transaccionales (bienvenida, notificaciones de pedido, recuperación de contraseña)</li>
          <li>Mejorar el producto basados en uso agregado</li>
          <li>Cumplir obligaciones legales</li>
        </ul>
        <p>
          <b>No vendemos tu información ni la de tus clientes a terceros.</b>{' '}
          Nunca.
        </p>

        <h2 className="text-lg font-semibold mt-6">Tus derechos</h2>
        <p>Puedes en cualquier momento:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <b>Acceder y descargar</b> tus datos: desde el panel puedes
            descargar tus clientes, sus sellos y tus pedidos, y pedirnos
            cualquier otra información que tengamos sobre ti.
          </li>
          <li>
            <b>Modificar</b> tu información desde el panel.
          </li>
          <li>
            <b>Pedir la eliminación</b> de tu cuenta y de los datos asociados
            escribiéndonos al correo de contacto de esta página.
          </li>
          <li>
            <b>Quejarte</b> ante la autoridad de protección de datos de tu
            país si crees que mal manejamos tu información.
          </li>
        </ul>

        <h2 className="text-lg font-semibold mt-6">Retención de datos</h2>
        <p>
          Conservamos tus datos mientras tu cuenta está activa y, tras la
          cancelación, para permitirte reactivarla. Si nos pides eliminarlos,
          los borramos, salvo los datos financieros que la ley nos obligue a
          conservar. Las copias de seguridad cifradas se renuevan cada 30 días,
          así que un dato eliminado desaparece también de ellas en ese plazo.
        </p>

        <h2 className="text-lg font-semibold mt-6">Cookies</h2>
        <p>
          Usamos cookies esenciales para la sesión y tus preferencias. En
          nuestras páginas públicas usamos además el píxel de Meta para medir
          nuestros anuncios. Si un negocio configura su propio píxel, este
          funciona en su menú público y los datos que recoge pertenecen a ese
          negocio. No vendemos información a anunciantes.
        </p>

        <h2 className="text-lg font-semibold mt-6">Cambios a esta política</h2>
        <p>
          Si actualizamos esta política te notificaremos por email con al menos
          15 días de anticipación.
        </p>

        <h2 className="text-lg font-semibold mt-6">Contacto</h2>
        <p>
          Para ejercer tus derechos o cualquier duda sobre privacidad
          escríbenos a{' '}
          <a href={`mailto:${brand.privacyEmail}`} className="text-brand">
            {brand.privacyEmail}
          </a>
          .
        </p>
      </section>
    </>
  );
}

export const metadata = {
  title: 'Términos y condiciones',
};

export default function TermsPage() {
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight mb-1">Términos y condiciones</h1>
      <p className="text-sm text-mute">Última actualización: mayo 2026</p>

      <section className="mt-8 space-y-5 text-sm leading-relaxed">
        <h2 className="text-lg font-semibold mt-6">1. Sobre Clubify</h2>
        <p>
          Clubify es un software como servicio (SaaS) operado por Nudo Creativo
          que permite a negocios locales en LATAM gestionar pedidos por
          WhatsApp, emitir tarjetas de fidelización digitales (Apple Wallet /
          Google Wallet) y automatizar mensajes a sus clientes.
        </p>

        <h2 className="text-lg font-semibold mt-6">2. Cuenta y suscripción</h2>
        <p>
          Al crear una cuenta debes completar el pago inicial vía Hotmart
          para activarla. El plan Elite tiene un costo de USD 50/mes y el
          plan Pro de USD 99/mes (o el equivalente en tu moneda local al
          cambio del día, según la tasa que aplique Hotmart).
        </p>
        <p>
          Apenas se aprueba el primer pago la cuenta queda activa. La
          suscripción se renueva automáticamente cada mes hasta que decidas
          cancelarla desde tu panel.
        </p>

        <h2 className="text-lg font-semibold mt-6">3. Cancelación</h2>
        <p>
          Puedes cancelar tu suscripción en cualquier momento desde tu panel en{' '}
          <code>/app/billing</code>. La cancelación es efectiva inmediatamente:
          tu storefront público dejará de recibir pedidos y el panel quedará
          bloqueado para escrituras. Tu información se conserva durante 30 días
          por si decides reactivar; después se elimina permanentemente.
        </p>

        <h2 className="text-lg font-semibold mt-6">4. Uso aceptable</h2>
        <p>
          Te comprometes a no usar Clubify para: (a) enviar spam o mensajes no
          autorizados, (b) infringir derechos de propiedad intelectual de
          terceros, (c) realizar actividades ilegales o fraudulentas, (d)
          intentar comprometer la seguridad del servicio o de otros usuarios.
        </p>
        <p>
          Nos reservamos el derecho de suspender cuentas que violen estos
          términos sin reembolso.
        </p>

        <h2 className="text-lg font-semibold mt-6">5. Propiedad de los datos</h2>
        <p>
          Todos los datos que cargues en Clubify (clientes, productos, pedidos,
          imágenes) son de tu propiedad. Te otorgamos exportación libre en
          cualquier momento desde tu panel.
        </p>
        <p>
          Clubify mantiene la propiedad del software, marca, código fuente,
          diseño y contenidos propios de la plataforma.
        </p>

        <h2 className="text-lg font-semibold mt-6">6. Disponibilidad</h2>
        <p>
          Hacemos lo posible para mantener el servicio disponible 24/7 con un
          objetivo de uptime del 99.5%. No garantizamos disponibilidad
          ininterrumpida y no somos responsables por pérdidas derivadas de
          caídas excepcionales.
        </p>

        <h2 className="text-lg font-semibold mt-6">7. Limitación de responsabilidad</h2>
        <p>
          Clubify se ofrece "tal cual". En ningún caso nuestra responsabilidad
          excederá el monto que hayas pagado en los 3 meses previos al
          incidente.
        </p>

        <h2 className="text-lg font-semibold mt-6">8. Cambios a los términos</h2>
        <p>
          Podemos actualizar estos términos. Te notificaremos por email con al
          menos 15 días de anticipación cuando hagamos cambios materiales.
        </p>

        <h2 className="text-lg font-semibold mt-6">9. Contacto</h2>
        <p>
          Para cualquier duda escríbenos a{' '}
          <a href="mailto:hola@soyclubify.com" className="text-brand">
            hola@soyclubify.com
          </a>{' '}
          o por WhatsApp.
        </p>
      </section>
    </>
  );
}

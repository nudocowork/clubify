import { resolveLegalBrand } from '@/lib/legal-brand';

export const metadata = {
  title: 'Términos y condiciones',
};

// Única versión de los términos. `/terminos` (afiliados y prueba gratis)
// redirige aquí a #afiliados: antes había dos textos distintos y se
// contradecían. Cada cláusula describe lo que el sistema HACE hoy — si cambia
// el comportamiento (cancelación, prueba, exportación), cambia este texto.
export default async function TermsPage() {
  const brand = await resolveLegalBrand();
  const h2 = 'text-lg font-semibold mt-6 scroll-mt-6';
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight mb-1">Términos y condiciones</h1>
      <p className="text-sm text-mute">Última actualización: octubre 2026</p>

      <section className="mt-8 space-y-5 text-sm leading-relaxed">
        <h2 className={h2}>1. Sobre {brand.brandName}</h2>
        <p>
          {brand.brandName} es un software como servicio (SaaS) operado por{' '}
          {brand.operator} que permite a negocios gestionar pedidos, emitir
          tarjetas de fidelización digitales (Apple Wallet y Google Wallet) y
          automatizar mensajes a sus clientes.
        </p>
        <p>
          Al crear una cuenta, iniciar una prueba gratis, registrarte como
          afiliado o usar el servicio, aceptas estos términos y nuestra{' '}
          <a href="/legal/privacy" className="text-brand hover:underline">
            política de privacidad
          </a>
          . Si los aceptas en nombre de un negocio, declaras tener autorización
          para hacerlo.
        </p>

        <h2 className={h2}>2. Cuenta</h2>
        <p>
          Debes registrar información veraz y mantener la confidencialidad de tu
          contraseña. Eres responsable de lo que se haga desde tu cuenta y desde
          las cuentas de las personas de tu equipo a las que des acceso.
        </p>

        <h2 className={h2}>3. Prueba gratis</h2>
        <p>
          Podemos ofrecer un período de prueba gratis. Su duración es la que se
          indica al registrarte. Durante la prueba la cuenta funciona con
          normalidad y no se cobra nada.
        </p>
        <p>
          Si la prueba se inició registrando un medio de pago, al terminar se
          cobra automáticamente el plan elegido, salvo que la canceles antes de
          esa fecha. Si se inició sin medio de pago, al terminar la cuenta queda
          en pausa hasta que actives un plan.
        </p>

        <h2 className={h2}>4. Planes, pagos y renovación</h2>
        <p>
          Ofrecemos planes con distintas periodicidades (mensual, trimestral,
          anual u otras). El precio vigente de cada plan se muestra en{' '}
          <a href="/" className="text-brand hover:underline">
            {brand.domain}
          </a>{' '}
          antes de pagar. Los pagos se procesan a través de{' '}
          {brand.paymentProvider}; no almacenamos los datos de tu tarjeta. Si
          pagas en una moneda distinta a la del plan, se aplica la tasa de
          cambio de la pasarela de pago.
        </p>
        <p>
          La cuenta queda activa apenas se aprueba el pago. La suscripción se
          renueva automáticamente al final de cada período con el mismo plan,
          hasta que la canceles. Si un cobro de renovación falla, te avisaremos
          y la cuenta puede pausarse hasta que el pago se regularice.
        </p>

        <h2 className={h2}>5. Cancelación</h2>
        <p>
          Puedes cancelar tu suscripción en cualquier momento desde la sección
          de facturación de tu panel. Al cancelar no se vuelve a cobrar, y
          conservas el servicio hasta el final del período que ya pagaste.
          Terminado ese período, tu página pública deja de recibir pedidos y el
          panel queda en pausa.
        </p>
        <p>
          Tu información se conserva por si decides reactivar la cuenta. Si
          prefieres que la eliminemos, puedes pedirlo por los canales de
          contacto de la sección 15.
        </p>

        <h2 className={h2}>6. Reembolsos</h2>
        <p>
          Si la oferta con la que pagaste incluye un período de garantía, puedes
          pedir el reembolso dentro de ese período y se tramita a través de la
          pasarela de pago. Fuera de él, los pagos ya realizados no son
          reembolsables, incluidos los de períodos que cancelaste antes de que
          terminaran, salvo en los casos en que la ley aplicable exija lo
          contrario.
        </p>

        <h2 className={h2}>7. Uso aceptable</h2>
        <p>
          Te comprometes a no usar {brand.brandName} para: (a) enviar spam o
          mensajes a personas que no lo autorizaron, (b) infringir derechos de
          propiedad intelectual de terceros, (c) realizar actividades ilegales,
          engañosas o fraudulentas, (d) suplantar a otra persona o negocio, o
          (e) intentar comprometer la seguridad del servicio o de otros
          usuarios.
        </p>
        <p>
          Podemos suspender o cerrar las cuentas que incumplan estos términos,
          sin reembolso de lo pagado.
        </p>

        <h2 className={h2}>8. Tus datos y los de tus clientes</h2>
        <p>
          Los datos que cargas en {brand.brandName} (clientes, productos,
          pedidos, imágenes) son de tu propiedad. Desde tu panel puedes
          descargar tus clientes, sus sellos y tus pedidos; si necesitas otra
          información, puedes pedirla por los canales de contacto.
        </p>
        <p>
          Sobre los datos personales de tus clientes, tu negocio es el
          responsable del tratamiento y {brand.operator} actúa como encargado:
          los tratamos solo para prestarte el servicio, no los vendemos ni los
          usamos para fines propios. Te corresponde contar con la autorización
          de tus clientes para registrarlos y enviarles mensajes, y atender sus
          solicitudes de consulta, corrección o eliminación. El detalle está en
          nuestra{' '}
          <a href="/legal/privacy" className="text-brand hover:underline">
            política de privacidad
          </a>{' '}
          y en la{' '}
          <a href="/legal/tratamiento-datos" className="text-brand hover:underline">
            política de tratamiento de datos
          </a>
          .
        </p>

        <h2 className={h2}>9. Servicios de terceros</h2>
        <p>
          Parte del servicio depende de terceros: la pasarela de pago, Apple y
          Google para las tarjetas digitales, y los proveedores de WhatsApp, SMS
          y correo para los mensajes. Sus condiciones también aplican, y no
          respondemos por fallas o cambios que dependan de ellos.
        </p>

        <h2 className={h2}>10. Propiedad intelectual</h2>
        <p>
          {brand.brandName} conserva la propiedad del software, la marca, el
          código fuente, el diseño y los contenidos propios de la plataforma.
          Tu suscripción te da derecho a usarlos mientras esté vigente, no a
          copiarlos ni a revenderlos.
        </p>

        <h2 className={h2} id="afiliados">
          11. Programa de afiliados
        </h2>
        <p>
          Como afiliado recibes un código y enlaces propios para referir
          negocios. Ganas comisión por los negocios que refieras y que paguen un
          plan. El monto o porcentaje de la comisión, y si es de pago único o
          recurrente, es el que se muestra al registrarte y el vigente al
          momento de cada venta.
        </p>
        <p>
          Una venta solo se te atribuye si el negocio pagó con tus enlaces o si
          el equipo la asigna a tu código. Usa siempre los enlaces de tu panel:
          un enlace que no lleve tu código no se te puede atribuir de forma
          automática.
        </p>
        <p>
          No se pagan comisiones por pruebas gratis (la comisión nace con el
          primer cobro real), por ventas reembolsadas o canceladas, por
          auto-referidos ni por ventas obtenidas con fraude, spam o
          suplantación. Las comisiones se pagan según el calendario y el mínimo
          de retiro informados en tu panel. Eres responsable de los impuestos
          que te correspondan en tu país.
        </p>

        <h2 className={h2}>12. Disponibilidad</h2>
        <p>
          Hacemos lo posible por mantener el servicio disponible las 24 horas,
          con un objetivo del 99,5 % del tiempo. No garantizamos un servicio
          ininterrumpido: puede haber mantenimientos y caídas excepcionales.
        </p>

        <h2 className={h2}>13. Limitación de responsabilidad</h2>
        <p>
          {brand.brandName} se ofrece «tal cual». En la medida en que la ley lo
          permita, no respondemos por daños indirectos, como pérdida de ventas o
          de ganancias, y nuestra responsabilidad total no superará lo que hayas
          pagado en los 3 meses anteriores al hecho que la origine.
        </p>

        <h2 className={h2}>14. Cambios y ley aplicable</h2>
        <p>
          Podemos actualizar estos términos. Cuando el cambio sea importante te
          avisaremos por correo con al menos 15 días de anticipación; seguir
          usando el servicio después de esa fecha implica que aceptas la nueva
          versión.
        </p>
        <p>
          {brand.isClubify
            ? 'Estos términos se rigen por las leyes de la República de Colombia. Cualquier controversia se intentará resolver primero de forma directa; si no es posible, se someterá a los jueces competentes de Colombia.'
            : `Estos términos se rigen por las leyes del país donde ${brand.operator} tiene su domicilio. Cualquier controversia se intentará resolver primero de forma directa; si no es posible, se someterá a los jueces competentes de ese país.`}
        </p>

        <h2 className={h2}>15. Contacto</h2>
        <p>
          Para cualquier duda escríbenos a{' '}
          <a href={`mailto:${brand.contactEmail}`} className="text-brand">
            {brand.contactEmail}
          </a>
          {brand.whatsapp ? (
            <>
              {' '}o por{' '}
              <a
                href={`https://wa.me/${brand.whatsapp}`}
                target="_blank"
                rel="noreferrer"
                className="text-brand"
              >
                WhatsApp
              </a>
              .
            </>
          ) : (
            '.'
          )}
        </p>
      </section>
    </>
  );
}

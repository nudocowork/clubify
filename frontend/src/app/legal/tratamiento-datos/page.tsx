// PDF Software(8): documento POR DEFECTO que ve el CLIENTE FINAL al registrar su
// tarjeta de fidelización (enlace de la casilla "Acepto las políticas de
// tratamiento de datos" en /c/[cardId]). Redacción NEUTRAL, centrada solo en los
// datos del cliente y su tratamiento. NO habla de negocio/facturación/marca
// blanca (eso vive en /legal/privacy, que es para el dueño del negocio).

export const metadata = {
  title: 'Política de tratamiento de datos',
};

export default function DataTreatmentPage() {
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight mb-1">
        Política de tratamiento de datos
      </h1>
      <p className="text-sm text-mute">
        Cómo tratamos los datos de tu tarjeta de fidelización · Última
        actualización: agosto 2026
      </p>

      <section className="mt-8 space-y-5 text-sm leading-relaxed">
        <p>
          Cuando registras tu tarjeta de fidelización, tratamos algunos de tus
          datos personales para poder darte el servicio. Aquí te explicamos qué
          datos guardamos, para qué los usamos y cómo puedes controlarlos.
        </p>

        <h2 className="text-lg font-semibold mt-6">Qué datos guardamos de ti</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Tu nombre y tu número de teléfono.</li>
          <li>Tu correo electrónico, si decides compartirlo (opcional).</li>
          <li>
            Tu fecha de cumpleaños, si decides compartirla (opcional), solo para
            que el negocio pueda enviarte un saludo o un beneficio.
          </li>
          <li>
            Tu actividad en el programa: sellos acumulados, cupones, premios y
            consumos, y la fecha de tu último sello.
          </li>
        </ul>

        <h2 className="text-lg font-semibold mt-6">Para qué los usamos</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Operar tu tarjeta: registrar tus sellos, cupones y premios.</li>
          <li>Crear y actualizar tu pase en Apple Wallet o Google Wallet.</li>
          <li>
            Enviarte las notificaciones y mensajes que el negocio configure (por
            ejemplo, un aviso cuando ganas un premio o un saludo de cumpleaños).
          </li>
        </ul>
        <p>
          <b>No vendemos tus datos ni los usamos para publicidad de terceros.</b>{' '}
          Solo los usamos para darte este servicio.
        </p>

        <h2 className="text-lg font-semibold mt-6">
          Notificaciones por cercanía (billetera)
        </h2>
        <p>
          Si guardas la tarjeta en tu billetera digital, tu teléfono puede
          mostrarte un aviso cuando estás cerca del negocio. Esa función la
          controla tu propio dispositivo: <b>no recibimos ni guardamos tu
          ubicación</b>. Puedes activarla o desactivarla desde los ajustes de tu
          billetera.
        </p>

        <h2 className="text-lg font-semibold mt-6">
          Tus notificaciones, bajo tu control
        </h2>
        <p>
          Puedes dejar de recibir notificaciones cuando quieras: elimina la
          tarjeta de tu billetera o desactiva las notificaciones del pase desde
          tu dispositivo.
        </p>

        <h2 className="text-lg font-semibold mt-6">Tus derechos</h2>
        <p>
          En cualquier momento puedes pedir <b>acceder</b>, <b>corregir</b> o{' '}
          <b>eliminar</b> tus datos. Como el negocio donde te registraste es
          quien administra tu información, escríbele directamente a ese negocio
          para ejercer estos derechos.
        </p>

        <h2 className="text-lg font-semibold mt-6">Quién responde por tus datos</h2>
        <p>
          El negocio donde registraste tu tarjeta es el responsable de tus
          datos. La plataforma que opera la tarjeta los procesa únicamente por
          cuenta de ese negocio y solo para darte este servicio; no los mezcla
          con los de otros negocios ni los usa para fines propios.
        </p>

        <h2 className="text-lg font-semibold mt-6">Seguridad</h2>
        <p>
          Protegemos tu información con cifrado en tránsito y accesos
          restringidos. Ningún sistema es infalible, pero aplicamos medidas
          razonables para mantener tus datos seguros.
        </p>

        <p className="text-mute">
          Al registrar tu tarjeta y aceptar esta política, autorizas el
          tratamiento de tus datos para las finalidades aquí descritas.
        </p>
      </section>
    </>
  );
}

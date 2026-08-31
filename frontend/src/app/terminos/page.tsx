import Link from 'next/link';
import { resolveBrandFromHeaders } from '@/lib/server-brand';
import { authBrandCss } from '@/lib/panel-brand-theme';

// Términos y Condiciones — página PÚBLICA y brand-aware. Se sirve en el dominio
// de cada marca (selleala.com/terminos, etc.). El nombre y el color salen de la
// marca resuelta por host; sin marca (Clubify/dev) usa "Clubify" y el verde por
// defecto. El link de registro-afiliado y el de la prueba gratuita apuntan acá.
//
// ⚠ CONTENIDO GENÉRICO/EDITABLE: es una base razonable, NO asesoría legal. El
// negocio debe revisarlo/ajustarlo con su equipo legal.
export const metadata = { title: 'Términos y condiciones' };

export default async function TerminosPage() {
  const brand = await resolveBrandFromHeaders();
  const name = brand?.name ?? 'Clubify';
  const color = brand?.primaryColor || null;

  const Section = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
    <section className="mt-6">
      <h2 className="text-base font-bold">
        {n}. {title}
      </h2>
      <div className="text-sm text-mute mt-1.5 leading-relaxed space-y-2">{children}</div>
    </section>
  );

  return (
    <main className="min-h-screen bg-bg px-5 py-10">
      {color && <style dangerouslySetInnerHTML={{ __html: authBrandCss(color) }} />}
      <div className="brand-auth max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold">Términos y condiciones</h1>
        <p className="text-sm text-mute mt-1.5">
          Estos términos regulan el uso de los servicios de {name} y la
          participación en su programa de afiliados.
        </p>

        <Section n={1} title="Aceptación">
          <p>
            Al crear una cuenta, registrarte como afiliado o usar los servicios
            de {name}, aceptas estos términos. Si no estás de acuerdo, no uses
            el servicio.
          </p>
        </Section>

        <Section n={2} title="El servicio">
          <p>
            {name} ofrece herramientas de fidelización, tarjetas digitales y
            comunicación con clientes para negocios. El servicio puede cambiar,
            mejorarse o suspenderse; te avisaremos de cambios relevantes.
          </p>
        </Section>

        <Section n={3} title="Cuentas">
          <p>
            Eres responsable de la información que registras y de mantener tu
            contraseña segura. La actividad realizada desde tu cuenta es tu
            responsabilidad.
          </p>
        </Section>

        <Section n={4} title="Programa de afiliados">
          <p>
            Los afiliados (influencers y embajadores) generan una comisión por
            los negocios que refieren y que se convierten en clientes. El monto o
            porcentaje de comisión, y si es de pago único o recurrente, es el que
            se muestra al registrarte y el vigente al momento de cada venta
            atribuida.
          </p>
          <p>
            Las comisiones se acreditan por ventas reales atribuidas a tu código
            o enlace. No se pagan comisiones por auto-referidos, fraude, ni por
            ventas reembolsadas o canceladas.
          </p>
        </Section>

        <Section n={5} title="Pagos">
          <p>
            Los pagos de comisiones se realizan según el calendario y el mínimo
            de retiro informados en tu panel. Eres responsable de los impuestos
            que apliquen en tu país.
          </p>
        </Section>

        <Section n={6} title="Datos personales">
          <p>
            Tratamos tus datos conforme a nuestra política de privacidad. No
            vendemos tus datos. Los datos de los clientes referidos se usan solo
            para prestar el servicio.
          </p>
        </Section>

        <Section n={7} title="Uso aceptable">
          <p>
            No está permitido el spam, la suplantación, ni el uso del servicio
            para fines ilícitos o engañosos. Podemos suspender cuentas que
            incumplan estas reglas.
          </p>
        </Section>

        <Section n={8} title="Responsabilidad">
          <p>
            El servicio se presta &quot;tal cual&quot;. En la medida permitida por
            la ley, {name} no es responsable de daños indirectos derivados del
            uso del servicio.
          </p>
        </Section>

        <Section n={9} title="Cambios">
          <p>
            Podemos actualizar estos términos. La versión vigente es la publicada
            en esta página; el uso continuado implica su aceptación.
          </p>
        </Section>

        <Section n={10} title="Contacto">
          <p>Para dudas sobre estos términos, contacta al equipo de {name}.</p>
        </Section>

        <div className="mt-8">
          <Link href="/" className="btn-ghost">
            ← Volver al inicio
          </Link>
        </div>
      </div>
    </main>
  );
}

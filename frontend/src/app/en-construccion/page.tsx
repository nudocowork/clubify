/**
 * Página de "en construcción" para la raíz de soyfidelity.com.
 * El middleware reescribe soyfidelity.com/ (y www) aquí mientras no exista
 * la landing definitiva. El acceso al master admin es por /login.
 *
 * Server component sin llamadas al API — evita cualquier error de red o de
 * sesión al pintar la portada.
 */
export const metadata = {
  title: 'Soyfidelity · En construcción',
  robots: { index: false, follow: false },
};

export default function EnConstruccionPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-100 px-4">
      <div className="max-w-md text-center">
        <div className="text-7xl mb-6">🚧</div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">
          Estamos en construcción
        </h1>
        <p className="mt-4 text-base md:text-lg text-slate-600 leading-relaxed">
          Muy pronto vas a encontrar aquí nuestra página. Estamos trabajando en
          ella.
        </p>
        <div className="mt-10">
          <a
            href="/login"
            className="inline-flex items-center justify-center rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800 transition-colors"
          >
            Acceso administradores →
          </a>
        </div>
      </div>
    </div>
  );
}

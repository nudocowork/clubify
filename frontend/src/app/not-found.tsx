import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="min-h-screen bg-bg flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div className="text-7xl font-bold bg-gradient-to-r from-brand-400 via-brand-500 to-brand-700 bg-clip-text text-transparent">
          404
        </div>
        <h1 className="text-2xl font-bold mt-3">Esta página no existe</h1>
        <p className="text-mute mt-2 leading-relaxed">
          O fue movida. Volvamos al inicio o entra a tu panel.
        </p>
        <div className="flex gap-2 justify-center mt-6">
          <Link href="/" className="btn-ghost">
            ← Inicio
          </Link>
          <Link href="/login" className="btn-primary">
            Entrar a mi panel
          </Link>
        </div>
      </div>
    </main>
  );
}

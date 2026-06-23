import { AuthBrandServer } from '@/components/AuthBrandServer';

// Tema de marca por host inyectado en server → primer paint sin flash (FODT).
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthBrandServer>{children}</AuthBrandServer>;
}

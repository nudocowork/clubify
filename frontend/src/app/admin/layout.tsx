import AppShell from '@/components/AppShell';
import { MaintenanceAdminBanner } from '@/components/MaintenanceAdminBanner';
import { resolveBrandFromHeaders } from '@/lib/server-brand';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // En el dominio propio de la marca, resolvemos su color en server por host →
  // el panel /admin pinta su tema desde el primer paint (sin flash FODT).
  const brand = await resolveBrandFromHeaders();
  return (
    <AppShell variant="admin" serverBrandColor={brand?.primaryColor ?? null}>
      <MaintenanceAdminBanner />
      {children}
    </AppShell>
  );
}

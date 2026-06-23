import AppShell from '@/components/AppShell';
import { MaintenanceAdminBanner } from '@/components/MaintenanceAdminBanner';
import { resolveBrandFromHeadersOrSlug } from '@/lib/server-brand';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Color por host (dominio propio) o, si entra por /admin/<slug> sin dominio
  // conectado, por el slug (header x-wl-slug del middleware). Tema en el primer
  // paint → sin flash FODT, también para marcas nuevas sin dominio.
  const brand = await resolveBrandFromHeadersOrSlug();
  return (
    <AppShell variant="admin" serverBrandColor={brand?.primaryColor ?? null}>
      <MaintenanceAdminBanner />
      {children}
    </AppShell>
  );
}

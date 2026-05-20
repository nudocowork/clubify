import AppShell from '@/components/AppShell';
import { MaintenanceAdminBanner } from '@/components/MaintenanceAdminBanner';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell variant="admin">
      <MaintenanceAdminBanner />
      {children}
    </AppShell>
  );
}

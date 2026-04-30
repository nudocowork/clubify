import AppShell from '@/components/AppShell';

export default function TenantLayout({ children }: { children: React.ReactNode }) {
  return <AppShell variant="app">{children}</AppShell>;
}

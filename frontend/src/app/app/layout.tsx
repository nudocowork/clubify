import AppShell from '@/components/AppShell';
import { WelcomePopup } from '@/components/WelcomePopup';

export default function TenantLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell variant="app">
      {children}
      <WelcomePopup />
    </AppShell>
  );
}

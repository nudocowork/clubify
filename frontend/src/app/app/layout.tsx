import AppShell from '@/components/AppShell';
import { OnboardingFlow } from '@/components/OnboardingFlow';

export default function TenantLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell variant="app">
      {children}
      <OnboardingFlow />
    </AppShell>
  );
}

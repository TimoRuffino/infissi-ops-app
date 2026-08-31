import { useAuth } from "@/_core/hooks/useAuth";
import { DashboardLayoutSkeleton } from "@/components/DashboardLayoutSkeleton";
import LegacyDashboardLayout from "@/components/layout/LegacyDashboardLayout";
import ModularControlLayout from "@/components/layout/ModularControlLayout";
import { useModularControl } from "@/contexts/UiGenerationContext";
import LoginPage from "@/pages/LoginPage";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { loading, user } = useAuth();
  const modularControl = useModularControl();

  if (loading) {
    return <DashboardLayoutSkeleton modularControl={modularControl} />;
  }
  if (!user) return <LoginPage />;

  return modularControl ? (
    <ModularControlLayout>{children}</ModularControlLayout>
  ) : (
    <LegacyDashboardLayout>{children}</LegacyDashboardLayout>
  );
}

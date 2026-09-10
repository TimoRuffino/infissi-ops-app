import { useAuth } from "@/_core/hooks/useAuth";
import { DashboardLayoutSkeleton } from "@/components/DashboardLayoutSkeleton";
import { FeedbackProvider } from "@/components/feedback/FeedbackProvider";
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

  // Il dialogo delle segnalazioni vive qui, sopra le due cornici: la voce nel
  // menu profilo e quella nella palette aprono lo stesso, e nessuna delle due
  // aggiunge un pixel allo schermo.
  return (
    <FeedbackProvider>
      {modularControl ? (
        <ModularControlLayout>{children}</ModularControlLayout>
      ) : (
        <LegacyDashboardLayout>{children}</LegacyDashboardLayout>
      )}
    </FeedbackProvider>
  );
}

import { ReactNode, useState } from "react"; // Import useState
import { DesktopSidebar } from "@/components/navigation/DesktopSidebar";
import { MobileHeader } from "@/components/navigation/MobileHeader";
import { MobileBottomNav } from "@/components/navigation/MobileBottomNav";
import { useBackupPrompt } from "@/contexts/BackupPromptContext"; // Import useBackupPrompt
import { BackupReminderDialog } from "@/components/backup/BackupReminderDialog"; // Import BackupReminderDialog
import { NotificationPanel } from "@/components/notifications/NotificationPanel"; // NEW: Import NotificationPanel
import { AssistantFab } from "@/components/assistant/AssistantFab";
import { AssistantSheet } from "@/components/assistant/AssistantSheet";
import { AssistantSettingsModal } from "@/components/assistant/AssistantSettingsModal";
import { useNudgeEngine } from "@/hooks/useNudges";
import { TrialBanner } from "@/components/paywall/TrialBanner";
import { LapsedBar } from "@/components/paywall/LapsedBar";
import { usePaymentCaptureNavigation } from "@/hooks/usePaymentCaptureNavigation";

interface AppLayoutProps {
  children: ReactNode;
}

export const AppLayout = ({ children }: AppLayoutProps) => {
  const { showBackupPrompt, triggerBackup, dismissBackupPrompt } = useBackupPrompt(); // Use the backup prompt context

  // Local reminders: evaluates on resume and after a data change, schedules at
  // most one notification a day. No-ops entirely until the user switches
  // reminders on in the bell → Reminders tab, so this costs nothing by default.
  useNudgeEngine();
  usePaymentCaptureNavigation();
  const [showNotificationPanel, setShowNotificationPanel] = useState(false); // NEW: State for notification panel
  const [showAssistant, setShowAssistant] = useState(false);
  const [showAssistantSettings, setShowAssistantSettings] = useState(false);

  const openAssistantSettings = () => {
    setShowAssistant(false);
    setShowAssistantSettings(true);
  };

  return (
    <div className="min-h-screen relative">
      {/* Mobile Header */}
      <MobileHeader
        onOpenNotifications={() => setShowNotificationPanel(true)}
        onOpenAssistantSettings={openAssistantSettings}
      />

      {/* Desktop Sidebar */}
      <DesktopSidebar onOpenNotifications={() => setShowNotificationPanel(true)} />
      
      {/* Main Content */}
      {/* app-main-safe replaces the old pt-14/pb-24/md:pt-0/md:pb-0 utilities.
          Those offsets now have to include env(safe-area-inset-*) so content
          clears the status bar and gesture bar under Android 15 edge-to-edge,
          and env() can't be expressed as a responsive Tailwind utility.
          See .app-main-safe in index.css. */}
      <main className="md:ml-72 md:mr-4 md:mt-4 md:mb-4 min-h-screen md:min-h-[calc(100vh-2rem)] app-main-safe">
        <div className="p-4 h-full">
          {/* Entitlement notices sit in the content flow rather than fixed to
              the viewport: a fixed strip would have to fight the mobile header,
              the bottom nav and two FABs for safe-area space, and neither of
              these is urgent enough to earn that. Each renders null unless it
              applies, so on the normal `active` path this costs nothing. */}
          <TrialBanner />
          <LapsedBar />
          {children}
        </div>
      </main>

      {/* Backup Reminder Dialog */}
      <BackupReminderDialog
        open={showBackupPrompt}
        onConfirmBackup={triggerBackup}
        onDismiss={dismissBackupPrompt}
      />

      {/* Mobile Bottom Navigation */}
      <MobileBottomNav />

      {/* NEW: Notification Panel */}
      <NotificationPanel
        open={showNotificationPanel}
        onOpenChange={setShowNotificationPanel}
      />

      {/* AI quick-add assistant */}
      <AssistantFab onClick={() => setShowAssistant(true)} />
      <AssistantSheet
        open={showAssistant}
        onOpenChange={setShowAssistant}
        onOpenSettings={openAssistantSettings}
      />
      <AssistantSettingsModal
        open={showAssistantSettings}
        onClose={() => setShowAssistantSettings(false)}
      />
    </div>
  );
};

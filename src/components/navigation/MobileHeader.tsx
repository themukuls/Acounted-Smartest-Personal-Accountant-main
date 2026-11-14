import { useState, useEffect, useRef } from "react";
import { User, Settings, Lock, LogOut, Phone, Mail, Edit, Upload, Download, Bell, MessageCircle, Sparkles } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useNavigate, Link } from "react-router-dom";
import { OnboardingModal } from "@/components/onboarding/OnboardingModal";
import { PersonalDetailsModal } from "@/components/profile/PersonalDetailsModal";
import { ChangePinModal } from "@/components/profile/ChangePinModal";
import { auth } from "@/integrations/indexeddb/auth";
import { backupIndexedDB } from "@/integrations/indexeddb/utils/backup";
import { restoreIndexedDB } from "@/integrations/indexeddb/utils/restore";
import { readSelectedBackupFile } from "@/integrations/indexeddb/utils/selectedBackup";
import { useBackupPrompt } from "@/contexts/BackupPromptContext";
import { useQueryClient } from "@tanstack/react-query";
import { useNotifications } from "@/hooks/useNotifications";

interface MobileHeaderProps {
  onOpenNotifications: () => void;
  onOpenAssistantSettings: () => void;
}

export const MobileHeader = ({ onOpenNotifications, onOpenAssistantSettings }: MobileHeaderProps) => {
  const { user, signOut, refreshUser } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showPersonalDetails, setShowPersonalDetails] = useState(false);
  const [showChangePin, setShowChangePassword] = useState(false);
  const [profileData, setProfileData] = useState<{ firstName: string; phone: string; email: string } | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { recordBackupPerformed } = useBackupPrompt();

  // Get notification count — drives the red badge on the avatar
  const { newNotificationsCount } = useNotifications();

  useEffect(() => {
    const fetchUserProfile = async () => {
      if (!user) {
        setLoadingProfile(false);
        return;
      }

      try {
        const { profile, error } = await auth.getUserProfileLocal(user.id);

        if (error) throw new Error(error);

        setProfileData({
          firstName: (profile as any)?.display_name || '',
          phone: profile?.phone || '',
          email: user.email || ''
        });
      } catch (error: any) {
        console.error('Error fetching user profile:', error);
        toast({
          title: "Error",
          description: error.message || "Failed to load profile data.",
          variant: "destructive",
        });
        setProfileData({
          firstName: user.email?.split('@')[0] || 'User',
          phone: '',
          email: user.email || ''
        });
      } finally {
        setLoadingProfile(false);
      }
    };

    fetchUserProfile();
  }, [user]);

  const handleLogout = async () => {
    try {
      await signOut();
      navigate("/auth");
    } catch (error: any) {
      toast({
        title: "Couldn't lock account",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleChangePersonalDetails = () => {
    setShowPersonalDetails(true);
  };

  const handleUpdateFinancialDetails = () => {
    setShowOnboarding(true);
  };

  const handleChangePin = () => {
    setShowChangePassword(true);
  };

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    toast({
      title: "Financial details updated",
      description: "Your financial information has been updated successfully.",
    });
  };

  const handleBackupData = async () => {
    if (!user) {
      toast({
        title: "Error",
        description: "You must be logged in to backup data.",
        variant: "destructive",
      });
      return;
    }
    try {
      const result = await backupIndexedDB(user.id);
      recordBackupPerformed();
      toast({
        title: "Backup Successful",
        description: `${result.filename} saved to ${result.location}.`,
      });
    } catch (error: any) {
      toast({
        title: "Backup Failed",
        description: error.message || "Could not backup your data.",
        variant: "destructive",
      });
    }
  };

  const handleImportDataClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";

    if (!user) {
      toast({
        title: "Authentication Error",
        description: "You must be logged in to import data.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Select first, inspect second. Android providers often label CSV files
      // as text/plain or application/octet-stream, so neither MIME nor the
      // filename is used to decide whether the backup is valid.
      const selected = await readSelectedBackupFile(file);

      if (selected.kind === 'csv') {
        const { validateCSVOwnership, importCSVToIndexedDB } =
          await import("@/integrations/indexeddb/utils/csvRestore");
        const { valid, error: ownershipError } = await validateCSVOwnership(
          selected.data, user.email ?? "", user.phone ?? ""
        );
        if (!valid) throw new Error(ownershipError ?? "This backup does not belong to this account.");

        const { imported, skipped } = await importCSVToIndexedDB(user.id, selected.data);
        const skippedCount = Object.values(skipped).reduce((a, b) => a + b, 0);

        await refreshUser();
        recordBackupPerformed();
        queryClient.invalidateQueries();

        toast({
          title: "CSV Imported!",
          description: skippedCount > 0
            ? `${imported} records restored. ${skippedCount} record${skippedCount === 1 ? "" : "s"} could not be imported.`
            : `${imported} records restored from backup.`,
        });
        return;
      }

      toast({
        title: "Importing data...",
        description: "Please wait while your data is being restored.",
        duration: 5000,
      });

      await restoreIndexedDB(user.id, selected.data);
      await refreshUser();
      recordBackupPerformed();

      queryClient.invalidateQueries({ queryKey: ['investmentSummary'] });
      queryClient.invalidateQueries({ queryKey: ['savingsGoals'] });
      queryClient.invalidateQueries({ queryKey: ['monthlyTransactionsForSavings'] });
      queryClient.invalidateQueries({ queryKey: ['quickActionsWeeklySummary'] });
      queryClient.invalidateQueries({ queryKey: ['weeklyBudgetProjections'] });
      queryClient.invalidateQueries({ queryKey: ['monthlyBudgetSummary'] });
      queryClient.invalidateQueries({ queryKey: ['recentTransactions'] });
      queryClient.invalidateQueries({ queryKey: ['activeNotifications'] });
      queryClient.invalidateQueries({ queryKey: ['seenNotificationIds'] });

      toast({
        title: "Import Successful",
        description: "Your data has been restored successfully!",
      });
    } catch (error: any) {
      console.error('Error importing data:', error);
      toast({
        title: "Import Failed",
        description: error.message || "The selected file is not a valid Acounted backup.",
        variant: "destructive",
      });
    }
  };

  const displayName = loadingProfile
    ? 'Loading...'
    : profileData?.firstName || profileData?.email?.split('@')[0] || 'User';

  const displayPhone = loadingProfile ? 'Loading...' : profileData?.phone || 'N/A';
  const displayEmail = loadingProfile ? 'Loading...' : profileData?.email || 'N/A';

  return (
    <div className="mobile-header">
      <div className="flex items-center justify-between px-4 py-1.5">
        {/* Logo */}
        <div className="flex items-center">
          <Link to="/" className="flex items-center pointer-events-auto">
            <img 
              src="/app-assets/acounted-logo.png" 
              alt="Acounted" 
              className="h-8 w-auto"
            />
          </Link>
        </div>

        {/* Right side: contact + avatar */}
        <div className="flex items-center gap-2">
          {/* Contact icon button — left of avatar */}
          <Link
            to="/contact"
            className="pointer-events-auto flex items-center justify-center h-8 w-8 rounded-full bg-gradient-to-br from-blue-700 to-blue-900 shadow-md hover:shadow-lg transition-all duration-200 active:scale-95"
          >
            <MessageCircle className="h-4 w-4 text-white" />
          </Link>

          <DropdownMenu>
            <DropdownMenuTrigger className="relative flex items-center gap-2 p-2 rounded-full bg-blue-500/10 backdrop-blur-sm border border-blue-500/30 hover:bg-blue-500/20 transition-all duration-300 shadow-lg pointer-events-auto">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-md">
                <User className="h-5 w-5 text-white" />
              </div>
              {/* Red notification badge on avatar */}
              {newNotificationsCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white shadow-md">
                  {newNotificationsCount > 9 ? '9+' : newNotificationsCount}
                </span>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent 
              align="end" 
              className="w-64 bg-white/95 backdrop-blur-md border border-white/20 shadow-xl z-50 pointer-events-auto"
            >
              <DropdownMenuLabel className="px-3 py-2">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium text-foreground whitespace-nowrap">
                    {displayName}
                  </p>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                    <Phone className="h-3 w-3" />
                    <span>{displayPhone}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                    <Mail className="h-3 w-3" />
                    <span>{displayEmail}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />

              {/* Notifications menu item with count badge */}
              <DropdownMenuItem
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer text-foreground hover:bg-white/50 pointer-events-auto"
                onClick={onOpenNotifications}
              >
                <Bell className="h-4 w-4" />
                <span className="whitespace-nowrap flex-1">Notifications</span>
                {newNotificationsCount > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                    {newNotificationsCount > 9 ? '9+' : newNotificationsCount}
                  </span>
                )}
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuItem 
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer text-foreground hover:bg-white/50 pointer-events-auto"
                onClick={handleChangePersonalDetails}
              >
                <Settings className="h-4 w-4" />
                <span className="whitespace-nowrap">Change Personal Details</span>
              </DropdownMenuItem>
              <DropdownMenuItem 
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer text-foreground hover:bg-white/50 pointer-events-auto"
                onClick={handleUpdateFinancialDetails}
              >
                <Edit className="h-4 w-4" />
                <span className="whitespace-nowrap">Update Financial Details</span>
              </DropdownMenuItem>
              <DropdownMenuItem 
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer text-foreground hover:bg-white/50 pointer-events-auto"
                onClick={handleChangePin}
              >
                <Lock className="h-4 w-4" />
                <span className="whitespace-nowrap">Change PIN</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer text-foreground hover:bg-white/50 pointer-events-auto"
                onClick={onOpenAssistantSettings}
              >
                <Sparkles className="h-4 w-4" />
                <span className="whitespace-nowrap">AI Assistant</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer text-foreground hover:bg-white/50 pointer-events-auto"
                onClick={handleBackupData}
              >
                <Download className="h-4 w-4" />
                <span className="whitespace-nowrap">Backup Data</span>
              </DropdownMenuItem>
              <DropdownMenuItem 
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer text-foreground hover:bg-white/50 pointer-events-auto"
                onClick={handleImportDataClick}
              >
                <Upload className="h-4 w-4" />
                <span className="whitespace-nowrap">Import Data</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer text-destructive hover:bg-destructive/10 pointer-events-auto"
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4" />
                <span className="whitespace-nowrap">Logout</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <OnboardingModal 
        open={showOnboarding} 
        onComplete={handleOnboardingComplete}
        onClose={() => setShowOnboarding(false)}
        forceStartStepZero={true}
      />
      
      <PersonalDetailsModal 
        open={showPersonalDetails} 
        onClose={() => setShowPersonalDetails(false)}
      />

      <ChangePinModal
        open={showChangePin}
        onClose={() => setShowChangePassword(false)}
      />

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
    </div>
  );
};

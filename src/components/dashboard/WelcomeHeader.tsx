import { useState, useEffect, useRef } from "react"; // Import useRef
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Settings, Lock, LogOut, Phone, Mail, Edit, User, Upload, Download, Sparkles } from "lucide-react"; // Import Upload and Download icons
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { OnboardingModal } from "@/components/onboarding/OnboardingModal";
import { PersonalDetailsModal } from "@/components/profile/PersonalDetailsModal";
import { ChangePinModal } from "@/components/profile/ChangePinModal";
import { AssistantSettingsModal } from "@/components/assistant/AssistantSettingsModal";
import { auth } from "@/integrations/indexeddb/auth";
import { backupIndexedDB } from "@/integrations/indexeddb/utils/backup";
import { restoreIndexedDB } from "@/integrations/indexeddb/utils/restore"; // Import restore function
import { useBackupPrompt } from "@/contexts/BackupPromptContext"; // Import useBackupPrompt
import { useQueryClient } from "@tanstack/react-query"; // NEW: Import useQueryClient
import { GlassCard } from "@/components/ui/glass-card";

export const WelcomeHeader = () => {
  const { user, signOut, refreshUser } = useAuth(); // Get refreshUser
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient(); // NEW: Initialize useQueryClient
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showPersonalDetails, setShowPersonalDetails] = useState(false);
  const [showChangePin, setShowChangePassword] = useState(false);
  const [showAssistantSettings, setShowAssistantSettings] = useState(false);
  const [profileData, setProfileData] = useState<{ firstName: string; phone: string; email: string } | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null); // Ref for hidden file input
  const { recordBackupPerformed } = useBackupPrompt(); // Use recordBackupPerformed from context

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
      recordBackupPerformed(); // Record that backup was performed
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
    fileInputRef.current?.click(); // Trigger the hidden file input
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      toast({
        title: "No file selected",
        description: "Please select a JSON backup file.",
        variant: "destructive",
      });
      return;
    }

    if (file.type !== "application/json") {
      toast({
        title: "Invalid file type",
        description: "Please select a JSON file.",
        variant: "destructive",
      });
      return;
    }

    if (!user) {
      toast({
        title: "Authentication Error",
        description: "You must be logged in to import data.",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const backupData = JSON.parse(content);

        toast({
          title: "Importing data...",
          description: "Please wait while your data is being restored.",
          duration: 5000, // Keep toast open longer for import
        });

        await restoreIndexedDB(user.id, backupData);
        await refreshUser(); // Refresh user context to update profile and onboarding status
        recordBackupPerformed(); // Record that backup was performed after successful import

        // NEW: Invalidate all relevant React Query caches to force a refetch on the homepage
        queryClient.invalidateQueries({ queryKey: ['investmentSummary'] });
        queryClient.invalidateQueries({ queryKey: ['savingsGoals'] });
        queryClient.invalidateQueries({ queryKey: ['monthlyTransactionsForSavings'] });
        queryClient.invalidateQueries({ queryKey: ['quickActionsWeeklySummary'] });
        queryClient.invalidateQueries({ queryKey: ['weeklyBudgetProjections'] });
        queryClient.invalidateQueries({ queryKey: ['monthlyBudgetSummary'] }); // NEW: Invalidate for the new hook
        queryClient.invalidateQueries({ queryKey: ['recentTransactions'] }); // NEW: Invalidate for the new hook

        toast({
          title: "Import Successful",
          description: "Your data has been restored successfully!",
        });
      } catch (error: any) {
        console.error('Error importing data:', error);
        toast({
          title: "Import Failed",
          description: error.message || "Could not import your data. Please ensure it's a valid backup file.",
          variant: "destructive",
        });
      } finally {
        // Clear the file input value to allow selecting the same file again if needed
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    };
    reader.readAsText(file);
  };

  const displayName = loadingProfile
    ? 'Loading...'
    : profileData?.firstName || profileData?.email?.split('@')[0] || 'User';

  const displayPhone = loadingProfile ? 'Loading...' : profileData?.phone || 'N/A';
  const displayEmail = loadingProfile ? 'Loading...' : profileData?.email || 'N/A';

  return (
    <div className="flex items-center gap-4 mb-6 hidden md:flex">
      <GlassCard className="text-center flex-1">
        <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-2">
          Hi {displayName.split(' ')[0]}! Let's track your finance
        </h2>
        <p className="text-muted-foreground">
          Take control of your financial future with AI-powered insights
        </p>
      </GlassCard>
      
      {/* User Profile Dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 p-2 rounded-full bg-blue-500/10 backdrop-blur-sm border border-blue-500/30 hover:bg-blue-500/20 transition-all duration-300 shadow-lg pointer-events-auto">
          <div className="h-12 w-12 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-md">
            <User className="h-6 w-6 text-white" />
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent 
          align="end" 
          className="w-64 bg-white/95 backdrop-blur-md border border-white/20 shadow-xl z-50 pointer-events-auto"
        >
          <DropdownMenuLabel className="px-3 py-2">
            <div className="flex flex-col space-y-1">
              <p className="text-sm font-medium text-foreground">
                {displayName}
              </p>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Phone className="h-3 w-3" />
                <span>{displayPhone}</span>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Mail className="h-3 w-3" />
                <span>{displayEmail}</span>
              </div>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem 
            className="flex items-center gap-3 px-3 py-2.5 cursor-pointer text-foreground hover:bg-white/50 pointer-events-auto"
            onClick={handleChangePersonalDetails}
          >
            <Settings className="h-4 w-4" />
            <span>Change Personal Details</span>
          </DropdownMenuItem>
          <DropdownMenuItem 
            className="flex items-center gap-3 px-3 py-2.5 cursor-pointer text-foreground hover:bg-white/50 pointer-events-auto"
            onClick={handleUpdateFinancialDetails}
          >
            <Edit className="h-4 w-4" />
            <span>Update Financial Details</span>
          </DropdownMenuItem>
          <DropdownMenuItem 
            className="flex items-center gap-3 px-3 py-2.5 cursor-pointer text-foreground hover:bg-white/50 pointer-events-auto"
            onClick={handleChangePin}
          >
            <Lock className="h-4 w-4" />
            <span>Change PIN</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="flex items-center gap-3 px-3 py-2.5 cursor-pointer text-foreground hover:bg-white/50 pointer-events-auto"
            onClick={() => setShowAssistantSettings(true)}
          >
            <Sparkles className="h-4 w-4" />
            <span>AI Assistant</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem 
            className="flex items-center gap-3 px-3 py-2.5 cursor-pointer text-foreground hover:bg-white/50 pointer-events-auto"
            onClick={handleBackupData}
          >
            <Download className="h-4 w-4" />
            <span>Backup Data</span>
          </DropdownMenuItem>
          <DropdownMenuItem 
            className="flex items-center gap-3 px-3 py-2.5 cursor-pointer text-foreground hover:bg-white/50 pointer-events-auto"
            onClick={handleImportDataClick}
          >
            <Upload className="h-4 w-4" />
            <span>Import Data</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem 
            className="flex items-center gap-3 px-3 py-2.5 cursor-pointer text-destructive hover:bg-destructive/10 pointer-events-auto"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            <span>Logout</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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

      <AssistantSettingsModal
        open={showAssistantSettings}
        onClose={() => setShowAssistantSettings(false)}
      />

      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".json"
        style={{ display: 'none' }}
      />
    </div>
  );
};

import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import Landing from "./Landing";
import MobileInstallPage from "./MobileInstallPage";
import { useDeviceDetection } from "@/hooks/use-device-detection";

const Home = () => {
  const { user, loading } = useAuth();
  const { isMobile, isStandalone } = useDeviceDetection();

  // Show loading state while checking authentication
  if (loading) {
    return (
      <div className="page-safe min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Authenticated user always goes straight to dashboard
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }

  // Mobile browser AND not installed (PWA or APK) → show install wall
  // Once installed, isStandalone becomes true (see use-device-detection hook)
  // so installed users always reach Landing with Log in / Get started
  if (isMobile && !isStandalone) {
    return <MobileInstallPage />;
  }

  // Desktop, or installed mobile app (PWA/APK) → show normal landing with auth
  return <Landing />;
};

export default Home;

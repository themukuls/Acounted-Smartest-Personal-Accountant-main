import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import React from "react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { PaywallScreen } from "@/components/paywall/PaywallScreen";
import { useEntitlement } from "@/hooks/useEntitlement";
import { BILLING_ENABLED } from "@/lib/entitlement/config";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { InstallPromptProvider } from "@/contexts/InstallPromptContext";
import { BackupPromptProvider } from "@/contexts/BackupPromptContext";
import { APKInstallProvider } from "@/contexts/APKInstallContext";
import { PWAInstallHandler } from "@/components/pwa/PWAInstallHandler";
import { APKInstallHandler } from "@/components/apk/APKInstallHandler";
import { useDeviceDetection } from "@/hooks/use-device-detection";
import { isNative } from "@/lib/platform";
import { AppPreloader } from "@/components/loader/AppPreloader";
import { App as CapacitorApp } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";
import Home from "./pages/Home";
import Auth from "./pages/Auth";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import IncomeGathering from "./pages/IncomeGathering";
import Expenses from "./pages/Expenses";
import TaxCopilot from "./pages/TaxCopilot";
import Budget from "./pages/Budget";
import TaxPlannerAI from "./pages/TaxPlannerAI";
import Contact from "./pages/Contact";
import UdharTracker from "./pages/UdharTracker";
import TaxCalendar from "./pages/TaxCalendar";
import AdvanceTax from "./pages/AdvanceTax";
import CapitalGains from "./pages/CapitalGains";
import TDSTracker from "./pages/TDSTracker";
import SalaryRestructuring from "./pages/SalaryRestructuring";
import ITRReadiness from "./pages/ITRReadiness";
import TaxCompliance from "./pages/TaxCompliance";
import Recall from "./pages/Recall";

const queryClient = new QueryClient();

// Guards /auth — only blocks access when on a mobile BROWSER that hasn't
// installed the app yet. Once installed as PWA or native app, isStandalone =
// true (see use-device-detection hook) so users can reach /auth normally.
function MobileAuthGuard({ children }: { children: React.ReactNode }) {
  const { isMobile, isStandalone } = useDeviceDetection();
  // Explicit isNative() short-circuit: inside the native app /auth is the only
  // way to sign in, so it must NEVER be gated. isStandalone already covers this
  // (isInstalledExperience() returns true when native), but the redirect here is
  // unrecoverable — a user bounced to "/" with no way back to /auth is locked
  // out of the app entirely — so this stays belt-and-braces on purpose.
  if (isNative()) {
    return <>{children}</>;
  }
  if (isMobile && !isStandalone) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

/**
 * Android hardware / gesture "back".
 *
 * Registering ANY backButton listener switches Capacitor out of its default
 * behaviour, so once we opt in we own the whole contract — including "don't
 * kill the app from a deep screen", which is the single most common way a
 * WebView-wrapped app gets one-star reviews.
 */
function useAndroidBackButton() {
  React.useEffect(() => {
    if (!isNative()) return;

    let removeListener: (() => void) | undefined;
    let unmounted = false;

    // addListener is async in Capacitor 7 — it can resolve after unmount, so
    // the handle has to be torn down defensively.
    void CapacitorApp.addListener("backButton", () => {
      // react-router's BrowserRouter stamps a monotonically increasing `idx`
      // onto history.state. idx > 0 means there is an earlier in-app screen to
      // return to. We deliberately ignore the event's own `canGoBack` flag: it
      // reports the raw WebView history, which also counts the <Navigate>
      // redirects our route guards perform, so it can read true on the very
      // first screen and false after a replace-navigation.
      const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;

      if (idx > 0) {
        window.history.back();
      } else {
        // Only the root screen exits. Anything deeper pops history instead.
        void CapacitorApp.exitApp();
      }
    }).then((handle) => {
      if (unmounted) {
        void handle.remove();
        return;
      }
      removeListener = () => void handle.remove();
    });

    return () => {
      unmounted = true;
      removeListener?.();
    };
  }, []);
}

/**
 * The blue band behind the status bar.
 *
 * Android 15 (targetSdk 35) forces edge-to-edge and has deprecated
 * Window.setStatusBarColor to a no-op, so StatusBar.setBackgroundColor() can no
 * longer tint that region. The app therefore paints it itself: a fixed strip
 * exactly as tall as the top safe-area inset. See .status-bar-band in index.css.
 *
 * Rendered unconditionally — on the web the inset is 0px, so it has no height
 * and costs nothing.
 */
function StatusBarBand() {
  return <div className="status-bar-band" aria-hidden="true" />;
}

/**
 * Status bar styling for the native shell.
 *
 * Style.Dark means LIGHT icons for a DARK background (the Capacitor naming
 * reads backwards). The band behind the clock and battery is now the #1E3A8A
 * primary, so the icons have to be white to stay legible — with Style.Light
 * they would be dark navy on dark navy.
 */
function useNativeStatusBar() {
  React.useEffect(() => {
    if (!isNative()) return;
    // Fire-and-forget: a status bar that fails to restyle is cosmetic, and on
    // some OEM builds these reject outright. Never let it break boot.
    void StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    // We have padded all fixed chrome with env(safe-area-inset-*), so make the
    // overlay explicit instead of depending on the platform default.
    void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
    // Pre-Android-15 devices still honour this, and it makes the band match
    // during the brief moment before the WebView paints. Harmless where the
    // platform ignores it.
    void StatusBar.setBackgroundColor({ color: '#1E3A8A' }).catch(() => {});
  }, []);
}

/**
 * Paths that must stay reachable with no subscription at all.
 *
 * "/" and "/auth" are how a person signs up in the first place — walling them
 * would lock a brand-new install out of creating the account the subscription
 * is going to attach to. "/subscribe" is the paywall itself.
 */
const OPEN_PATHS = new Set(["/", "/auth", "/subscribe"]);

/**
 * The wall — shown ONLY for status `none`, i.e. someone who has never
 * subscribed and hasn't reached the offer yet.
 *
 * Three things this deliberately does NOT do:
 *
 *  1. It does not gate the route. The app underneath renders normally; this is
 *     an overlay on top. Nothing waits on it, so a slow or failed billing check
 *     can never turn into a blank screen.
 *  2. It does not render before the stored snapshot has been read. `showPaywall`
 *     is false until hydration precisely so a paying subscriber never sees the
 *     offer flash on a cold start.
 *  3. It NEVER appears for `lapsed`. A lapsed user gets the whole app in
 *     read-only mode — their records, their exports, their history — with the
 *     paid actions refusing individually. Walling them off from two years of
 *     their own financial data because a card expired is the exact harm the
 *     entitlement core was written to prevent.
 */
function PaywallWall() {
  const { user } = useAuth();
  const { showPaywall, refresh } = useEntitlement();
  const { pathname } = useLocation();

  if (!BILLING_ENABLED || !user) return null;
  // First-run onboarding owns the payment decision. Showing this global wall
  // before that flow finishes would cover the value screens with a second
  // paywall and make the app look stuck.
  if (!(user as { onboarding_completed?: boolean }).onboarding_completed) return null;
  if (OPEN_PATHS.has(pathname)) return null;
  if (!showPaywall) return null;

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 overflow-y-auto bg-background">
      {/* No onDismiss: at `none` there is no subscription history and no app
          behind this to return to. A lapsed user reaches /subscribe instead,
          which does pass onDismiss. */}
      <PaywallScreen variant="onboarding" onSubscribed={() => refresh()} />
    </div>
  );
}

/**
 * /subscribe — the resubscribe route every locked surface links to.
 *
 * `onDismiss` is always supplied here, and it always works. That is the whole
 * point of the route existing: a lapsed user has to be able to walk up to the
 * offer, decide against it, and land back on their own records.
 */
function SubscribeRoute() {
  const navigate = useNavigate();

  if (!BILLING_ENABLED) return <Navigate to="/expenses" replace />;

  const leave = () => {
    // Same history-idx trick as the Android back button: idx > 0 means there is
    // a screen behind us. Otherwise send them somewhere with their data on it,
    // never to a dead end.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/expenses", { replace: true });
  };

  return <PaywallScreen variant="lapsed" onDismiss={leave} onSubscribed={leave} />;
}

// Hosts the routes plus the app-wide native behaviours.
// (The old useAutoSync() lived here; persistence is now the repository's job —
// it flushes pending writes on background without any React involvement.)
function AppContent() {
  useAndroidBackButton();
  useNativeStatusBar();

  return (
    <>
    <StatusBarBand />
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/track-savings" element={
        <ProtectedRoute>
          <Index />
        </ProtectedRoute>
      } />
      <Route path="/auth" element={<MobileAuthGuard><Auth /></MobileAuthGuard>} />
      <Route path="/income-setup" element={
        <ProtectedRoute>
          <IncomeGathering />
        </ProtectedRoute>
      } />
      <Route path="/dashboard" element={
        <ProtectedRoute>
          <Index />
        </ProtectedRoute>
      } />
      <Route path="/expenses" element={
        <ProtectedRoute>
          <Expenses />
        </ProtectedRoute>
      } />
      <Route path="/subscriptions" element={<Navigate to="/expenses" replace />} />
      {/* Tax Copilot — the merged chat + tax hub. The two old routes redirect
          so existing bookmarks and installed PWA shortcuts keep working. */}
      <Route path="/tax-copilot" element={
        <ProtectedRoute>
          <TaxCopilot />
        </ProtectedRoute>
      } />
      <Route path="/tax-optimization" element={<Navigate to="/tax-copilot" replace />} />
      <Route path="/tax-assistant" element={<Navigate to="/tax-copilot" replace />} />
      <Route path="/budget" element={
        <ProtectedRoute>
          <Budget />
        </ProtectedRoute>
      } />
      <Route path="/tax-planner-ai" element={
        <ProtectedRoute>
          <TaxPlannerAI />
        </ProtectedRoute>
      } />
      <Route path="/udhar-tracker" element={
        <ProtectedRoute>
          <UdharTracker />
        </ProtectedRoute>
      } />
      <Route path="/contact" element={
        <ProtectedRoute>
          <Contact />
        </ProtectedRoute>
      } />
      <Route path="/tax-calendar" element={
        <ProtectedRoute>
          <TaxCalendar />
        </ProtectedRoute>
      } />
      <Route path="/advance-tax" element={
        <ProtectedRoute>
          <AdvanceTax />
        </ProtectedRoute>
      } />
      <Route path="/capital-gains" element={
        <ProtectedRoute>
          <CapitalGains />
        </ProtectedRoute>
      } />
      <Route path="/tax-compliance" element={
        <ProtectedRoute>
          <TaxCompliance />
        </ProtectedRoute>
      } />
      <Route path="/salary-restructuring" element={
        <ProtectedRoute>
          <SalaryRestructuring />
        </ProtectedRoute>
      } />
      <Route path="/itr-readiness" element={
        <ProtectedRoute>
          <ITRReadiness />
        </ProtectedRoute>
      } />
      <Route path="/recall" element={
        <ProtectedRoute>
          <Recall />
        </ProtectedRoute>
      } />
      {/* The offer, reachable from every locked surface and from the lapsed
          bar. Protected because it is an in-app screen about an existing
          account, not a marketing page. */}
      <Route path="/subscribe" element={
        <ProtectedRoute>
          <SubscribeRoute />
        </ProtectedRoute>
      } />
      <Route path="*" element={<NotFound />} />
    </Routes>
    <PaywallWall />
    </>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      {/* Inside AuthProvider (it needs `loading`) but outside Router, so it
          covers every route including the pre-auth screens. */}
      <AppPreloader />
      <InstallPromptProvider>
        <APKInstallProvider>
          <BackupPromptProvider>
            <TooltipProvider>
              <Toaster />
              <Sonner />
              {/* Always BrowserRouter. Capacitor serves the bundle from
                  https://localhost with a native router that falls back to
                  index.html, so real paths work on Android exactly as on the
                  web — no HashRouter fallback needed, and no #/ URLs leaking
                  into shared links or the PWA manifest shortcuts. */}
              <BrowserRouter basename={import.meta.env.BASE_URL}>
                <AppContent />
              </BrowserRouter>
            </TooltipProvider>
          </BackupPromptProvider>
          <PWAInstallHandler />
          <APKInstallHandler />
        </APKInstallProvider>
      </InstallPromptProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;

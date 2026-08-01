"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useDeviceDetection } from '@/hooks/use-device-detection';
import { useAuth } from './AuthContext';

interface InstallPromptContextType {
  deferredPrompt: Event | null;
  isInstallable: boolean;
  isInstalled: boolean;
  triggerInstall: () => Promise<boolean>;
  dismissPrompt: () => void;
  showPWAInstallDialog: boolean;
  initiateDelayedPWAPrompt: () => void;
}

const InstallPromptContext = createContext<InstallPromptContextType | undefined>(undefined);

const PROMPT_DELAY_MS = 5000; // 5 seconds delay for initial dialog after login
const LAST_PWA_PROMPT_DISMISS_TIME_KEY = 'vidhence_last_pwa_prompt_dismiss_time';

export const InstallPromptProvider = ({ children }: { children: React.ReactNode }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<Event | null>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showPWAInstallDialog, setShowPWAInstallDialog] = useState(false);
  const [hasDismissedPWAPrompt, setHasDismissedPWAPrompt] = useState(false);
  const [triggerDelayedPrompt, setTriggerDelayedPrompt] = useState(false);

  const { toast } = useToast();
  const { isAndroid, isIOS, isDesktop } = useDeviceDetection();
  const { user } = useAuth();

  // 1. Handle browser's `beforeinstallprompt` and `appinstalled` events
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      // Only set installable if not on Android (to prioritize APK for Android)
      if (!isAndroid) {
        setDeferredPrompt(e);
        setIsInstallable(true);
        console.log('beforeinstallprompt event fired. App is now installable (PWA).');
      }
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsInstallable(false);
      setDeferredPrompt(null);
      setShowPWAInstallDialog(false);
      localStorage.setItem(LAST_PWA_PROMPT_DISMISS_TIME_KEY, Date.now().toString());
      console.log('PWA was installed.');
      toast({
        title: "App Installed!",
        description: "Acounted is now available as an app on your device.",
      });
    };

    // Check if already installed on load
    if (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone) {
      setIsInstalled(true);
      setIsInstallable(false);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [toast, isAndroid]);

  // 2. Load initial dismissal state from localStorage
  useEffect(() => {
    if (!isAndroid) { // Only for PWA-eligible devices
      // NEW: Remove the 7-day dismissal logic. Always allow prompt on new session if not installed.
      // The `hasDismissedPWAPrompt` state will now only reflect if the *current* session's prompt was dismissed.
      setHasDismissedPWAPrompt(false);
    }
  }, [isAndroid]);

  // 3. Effect to manage the delayed prompt after login
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    // Only trigger for PWA-eligible devices (iOS/Desktop) and if user is logged in
    // The `hasDismissedPWAPrompt` check is removed here to allow showing on every login.
    if ((isIOS || isDesktop) && user && isInstallable && !isInstalled && triggerDelayedPrompt) {
      console.log("InstallPromptProvider: Starting 5-second timer for PWA prompt.");
      timer = setTimeout(() => {
        setShowPWAInstallDialog(true);
        setTriggerDelayedPrompt(false); // Reset after showing
      }, PROMPT_DELAY_MS);
    } else {
      setShowPWAInstallDialog(false); // Ensure dialog is hidden if conditions are not met
      setTriggerDelayedPrompt(false); // Reset if user logs out or conditions change
    }
    return () => clearTimeout(timer);
  }, [isIOS, isDesktop, user, isInstallable, isInstalled, triggerDelayedPrompt]);

  const triggerInstall = useCallback(async () => {
    if (deferredPrompt) {
      const promptEvent = deferredPrompt as any; // Cast to any to access prompt()
      promptEvent.prompt(); // This shows the browser's native prompt
      const { outcome } = await promptEvent.userChoice;
      console.log(`User response to the install prompt: ${outcome}`);
      if (outcome === 'accepted') {
        // `appinstalled` event will handle setting `isInstalled` and toast
        return true;
      } else {
        toast({
          title: "Installation Cancelled",
          description: "You can install the app later using the floating button.",
          variant: "default",
        });
        return false;
      }
    }
    return false;
  }, [deferredPrompt, toast]);

  const dismissPWAInstallDialog = useCallback(() => {
    // NEW: This dismissal is only for the current session. It won't prevent showing on next login.
    setHasDismissedPWAPrompt(true);
    setShowPWAInstallDialog(false);
    toast({
      title: "PWA Prompt Dismissed",
      description: "You can still install the app later using the floating button.",
    });
  }, [toast]);

  const initiateDelayedPWAPrompt = useCallback(() => {
    // Only trigger for PWA-eligible devices (iOS/Desktop) and if user is logged in, PWA not installed, and not dismissed in *current* session
    if ((isIOS || isDesktop) && user && isInstallable && !isInstalled && !hasDismissedPWAPrompt) {
      setTriggerDelayedPrompt(true);
    }
  }, [isIOS, isDesktop, user, isInstallable, isInstalled, hasDismissedPWAPrompt]);

  const value = {
    deferredPrompt,
    isInstallable,
    isInstalled,
    triggerInstall,
    dismissPrompt: dismissPWAInstallDialog,
    showPWAInstallDialog,
    initiateDelayedPWAPrompt,
  };

  return <InstallPromptContext.Provider value={value}>{children}</InstallPromptContext.Provider>;
};

export const useInstallPrompt = () => {
  const context = useContext(InstallPromptContext);
  if (context === undefined) {
    throw new Error('useInstallPrompt must be used within an InstallPromptProvider');
  }
  return context;
};

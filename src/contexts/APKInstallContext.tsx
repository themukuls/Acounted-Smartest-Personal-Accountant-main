"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useDeviceDetection } from '@/hooks/use-device-detection';
import { useAuth } from './AuthContext';

interface APKInstallContextType {
  showAPKPrompt: boolean;
  hasDismissedAPKPrompt: boolean;
  hasPermanentlyDismissedFloatingButton: boolean;
  dismissFloatingButtonPermanently: () => void;
  triggerAPKDownload: () => void;
  dismissAPKPrompt: () => void;
  apkDownloadUrl: string;
  initiateDelayedAPKPrompt: () => void;
  isInstalled: boolean;
}

const APKInstallContext = createContext<APKInstallContextType | undefined>(undefined);

const APK_DOWNLOAD_URL = "https://x9ghsimrnqhvq0od.public.blob.vercel-storage.com/Acounted.apk";
const LAST_APK_PROMPT_DISMISS_TIME_KEY = 'vidhence_last_apk_prompt_dismiss_time';
const APK_FLOATING_BUTTON_PERMANENTLY_DISMISSED_KEY = 'vidhence_apk_floating_button_permanently_dismissed';
const PROMPT_DELAY_MS = 5000;

export const APKInstallProvider = ({ children }: { children: React.ReactNode }) => {
  const { isAndroid } = useDeviceDetection();
  const { toast } = useToast();
  const { user } = useAuth();

  const [showAPKPrompt, setShowAPKPrompt] = useState(false);
  const [hasDismissedAPKPrompt, setHasDismissedAPKPrompt] = useState(false);
  const [hasPermanentlyDismissedFloatingButton, setHasPermanentlyDismissedFloatingButton] = useState(false);
  const [triggerDelayedPrompt, setTriggerDelayedPrompt] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    if (isAndroid) {
      const permanentlyDismissed = localStorage.getItem(APK_FLOATING_BUTTON_PERMANENTLY_DISMISSED_KEY) === 'true';
      setHasPermanentlyDismissedFloatingButton(permanentlyDismissed);
      setHasDismissedAPKPrompt(false);

      // Treat the app as installed if:
      // 1. Running as installed PWA (display-mode: standalone)
      // 2. Running as installed APK — Android WebView uses file:// protocol
      //    and does NOT reliably report display-mode: standalone, so we use
      //    the protocol as the definitive signal.
      const isRunningStandalone =
        // AndroidBridge is injected by MainActivity.java — definitive APK signal
        typeof (window as any).AndroidBridge !== 'undefined' ||
        window.matchMedia('(display-mode: standalone)').matches ||
        !!(navigator as any).standalone ||
        window.location.protocol === 'file:' ||
        localStorage.getItem('vidhence_is_installed_user') === 'true';

      setIsInstalled(isRunningStandalone);

      if (isRunningStandalone) {
        console.log('APKInstallProvider: App detected as installed (standalone or APK).');
      }
    }
  }, [isAndroid]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (isAndroid && user && !hasPermanentlyDismissedFloatingButton && !isInstalled && triggerDelayedPrompt) {
      console.log("APKInstallProvider: Starting 5-second timer for APK prompt.");
      timer = setTimeout(() => {
        setShowAPKPrompt(true);
        setTriggerDelayedPrompt(false);
      }, PROMPT_DELAY_MS);
    } else {
      setShowAPKPrompt(false);
      setTriggerDelayedPrompt(false);
    }
    return () => clearTimeout(timer);
  }, [isAndroid, user, hasPermanentlyDismissedFloatingButton, isInstalled, triggerDelayedPrompt]);

  const dismissFloatingButtonPermanently = useCallback(() => {
    localStorage.setItem(APK_FLOATING_BUTTON_PERMANENTLY_DISMISSED_KEY, 'true');
    setHasPermanentlyDismissedFloatingButton(true);
    setShowAPKPrompt(false);
    toast({
      title: "App Install Reminder Dismissed",
      description: "You won't see the Android app install button again.",
    });
  }, [toast]);

  const triggerAPKDownload = useCallback(() => {
    if (APK_DOWNLOAD_URL) {
      const link = document.createElement('a');
      link.href = APK_DOWNLOAD_URL;
      link.download = 'Acounted.apk';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast({
        title: "Downloading App...",
        description: "Your Acounted APK is downloading. Please check your notifications or downloads folder.",
      });
    } else {
      toast({
        title: "Download Error",
        description: "APK download URL is not configured.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const dismissAPKPrompt = useCallback(() => {
    setHasDismissedAPKPrompt(true);
    setShowAPKPrompt(false);
    toast({
      title: "APK Prompt Dismissed",
      description: "You can still install the app later using the floating button.",
    });
  }, [toast]);

  const initiateDelayedAPKPrompt = useCallback(() => {
    if (isAndroid && user && !hasPermanentlyDismissedFloatingButton && !isInstalled && !hasDismissedAPKPrompt) {
      setTriggerDelayedPrompt(true);
    }
  }, [isAndroid, user, hasPermanentlyDismissedFloatingButton, isInstalled, hasDismissedAPKPrompt]);

  const value = {
    showAPKPrompt,
    hasDismissedAPKPrompt,
    hasPermanentlyDismissedFloatingButton,
    dismissFloatingButtonPermanently,
    triggerAPKDownload,
    dismissAPKPrompt,
    apkDownloadUrl: APK_DOWNLOAD_URL,
    initiateDelayedAPKPrompt,
    isInstalled,
  };

  return <APKInstallContext.Provider value={value}>{children}</APKInstallContext.Provider>;
};

export const useAPKInstall = () => {
  const context = useContext(APKInstallContext);
  if (context === undefined) {
    throw new Error('useAPKInstall must be used within an APKInstallProvider');
  }
  return context;
};

"use client";

import React from 'react';
import { useInstallPrompt } from '@/contexts/InstallPromptContext';
import { PWAInstallDialog } from './PWAInstallDialog';
import { PWAInstallFloatingButton } from './PWAInstallFloatingButton';
import { useDeviceDetection } from '@/hooks/use-device-detection';
import { isNative } from '@/lib/platform';

export const PWAInstallHandler = () => {
  const { isInstallable, isInstalled, triggerInstall, dismissPrompt, showPWAInstallDialog } = useInstallPrompt();
  const { isAndroid, isIOS, isDesktop } = useDeviceDetection();

  // Never prompt someone to install the app they are already running. Inside
  // the native WebView `beforeinstallprompt` should never fire anyway, but this
  // is a hard gate rather than a bet on WebView behaviour — a stray install
  // banner inside a shipped Play Store build is a review-blocking bug.
  if (isNative()) {
    return null;
  }

  // Only show PWA elements if it's a PWA-eligible device and installable
  const shouldShowPWAElements = (isIOS || isDesktop) && isInstallable && !isInstalled;

  if (!shouldShowPWAElements) {
    return null;
  }

  return (
    <>
      {showPWAInstallDialog && (
        <PWAInstallDialog
          open={showPWAInstallDialog}
          onInstall={triggerInstall} // This will trigger the browser's prompt
          onDismiss={dismissPrompt} // This will dismiss our custom dialog
        />
      )}
      {/* Show floating button if PWA is installable and not installed, regardless of dialog state */}
      {!isInstalled && (
        <PWAInstallFloatingButton
          onClick={triggerInstall} // This will trigger the browser's prompt
          className={isIOS ? "bottom-20 right-4" : "bottom-4 right-4"} 
        />
      )}
    </>
  );
};
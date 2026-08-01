"use client";

import React from 'react';
import { useAPKInstall } from '@/contexts/APKInstallContext';
import { useDeviceDetection } from '@/hooks/use-device-detection';
import { APKInstallDialog } from './APKInstallDialog';
import { APKInstallFloatingButton } from './APKInstallFloatingButton';
import { useAuth } from '@/contexts/AuthContext';
import { isNative } from '@/lib/platform';

export const APKInstallHandler = () => {
  const { isAndroid } = useDeviceDetection();
  const { user } = useAuth();
  const { 
    showAPKPrompt, 
    triggerAPKDownload, 
    dismissAPKPrompt, 
    hasPermanentlyDismissedFloatingButton, 
    dismissFloatingButtonPermanently,
    isInstalled, // NEW
  } = useAPKInstall();

  // Hard gate: inside the native app there is nothing to install and no APK to
  // download — the download link would hand the user a sideload copy of the app
  // they are already running. Checked before the isAndroid/user conditions
  // because those are all true on a native Android device.
  if (isNative()) {
    return null;
  }

  // Only render if it's an Android device AND the user is logged in AND the app is NOT already installed
  if (!isAndroid || !user || isInstalled) { // MODIFIED condition
    return null;
  }

  return (
    <>
      {showAPKPrompt && (
        <APKInstallDialog
          open={showAPKPrompt}
          onInstall={triggerAPKDownload}
          onDismiss={dismissAPKPrompt}
        />
      )}
      {/* Show floating button if not permanently dismissed and not currently showing the dialog */}
      {!hasPermanentlyDismissedFloatingButton && !showAPKPrompt && (
        <APKInstallFloatingButton
          onClick={triggerAPKDownload}
          onDismissPermanent={dismissFloatingButtonPermanently}
          positionClass="bottom-4 right-4"
        />
      )}
    </>
  );
};
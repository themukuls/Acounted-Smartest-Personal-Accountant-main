import { useState } from 'react';
import { isInstalledExperience } from '@/lib/platform';

interface DeviceDetection {
  isAndroid: boolean;
  isIOS: boolean;
  isDesktop: boolean;
  isMobile: boolean;
  isStandalone: boolean;
}

// Written to localStorage on first successful login/signup as a fallback
// signal for installs that don't expose AndroidBridge on the first load.
export const INSTALLED_USER_KEY = 'vidhence_is_installed_user';

export const useDeviceDetection = (): DeviceDetection => {
  const [device] = useState<DeviceDetection>(() => {
    const userAgent = typeof window.navigator === 'undefined' ? '' : navigator.userAgent;
    const isAndroid = /Android/i.test(userAgent);
    const isIOS     = /iPhone|iPad|iPod/i.test(userAgent);
    const isMobile  = isAndroid || isIOS;
    const isDesktop = !isMobile;

    const isStandalone =
      // 1. The native Capacitor app, or a browser-installed PWA (standalone
      //    display-mode / iOS Add-to-Home-Screen). platform.ts is the single
      //    source of truth for this — see the note there about why the old
      //    AndroidBridge and file:// sniffing no longer fires under Capacitor.
      isInstalledExperience() ||
      // 2. User has previously authenticated inside the app — long-term fallback
      //    for legacy WebView installs where detection is delayed or unreliable.
      localStorage.getItem(INSTALLED_USER_KEY) === 'true';

    return { isAndroid, isIOS, isDesktop, isMobile, isStandalone };
  });

  return device;
};

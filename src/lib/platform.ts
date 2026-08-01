/**
 * platform.ts — the single place that answers "where are we running?".
 *
 * The app previously sniffed `window.location.protocol === 'file:'` and the
 * presence of a hand-injected `AndroidBridge` to detect the old WebView APK.
 * Capacitor serves over https://localhost, so those checks are wrong now.
 * Everything routes through here instead, so there is one answer, not five.
 */

import { Capacitor } from '@capacitor/core';

/** True inside the Capacitor Android app. False in any browser. */
export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** 'android' | 'ios' | 'web' */
export function platformName(): string {
  try {
    return Capacitor.getPlatform();
  } catch {
    return 'web';
  }
}

export function isAndroid(): boolean {
  return platformName() === 'android';
}

/**
 * True when the app is running as an installed experience of any kind —
 * the native app, or a browser-installed PWA. Used to decide whether to show
 * install prompts (never show someone an install prompt for an app they are
 * already inside).
 */
export function isInstalledExperience(): boolean {
  if (isNative()) return true;
  try {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

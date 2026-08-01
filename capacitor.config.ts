import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Must stay exactly this — it is the existing Play Store identity for Acounted.
  // Changing it would orphan every existing install and upgrade path.
  appId: 'com.acounted.app',
  appName: 'Acounted',
  webDir: 'dist',

  server: {
    // 'https' is the Capacitor 7 default on Android, but it is spelled out here
    // because the app's entire persistence layer (IndexedDB, localStorage, OPFS)
    // is keyed by origin. Under the 'http' scheme the origin would be
    // http://localhost, and switching schemes later would silently orphan every
    // user's local data. Pinning it makes that a deliberate decision, not a default.
    androidScheme: 'https',
  },

  android: {
    // Never let the https://localhost WebView pull in plain-http subresources.
    // Financial data app — no mixed content, ever.
    allowMixedContent: false,
  },

  plugins: {
    SplashScreen: {
      // Long enough to cover React mount + IndexedDB open, short enough not to
      // feel like a stall. The app hides it explicitly once the tree is mounted.
      // The splash is now dismissed by the app, not by a timer. AppPreloader
      // calls SplashScreen.hide() the moment React is on screen and takes over
      // with its own copy loader. Previously launchAutoHide hid it after 1.5s
      // whether or not anything was ready — too early on a slow device (blank
      // white screen) and too late on a fast one (splash sitting over a
      // dashboard that was already up). launchShowDuration is retained only as
      // the value Capacitor falls back to if autoHide is ever turned back on.
      launchShowDuration: 1500,
      launchAutoHide: false,
      // White, to match the light splash drawable (navy wordmark on white).
      // This was #1E3A8A, which made sense when there was no splash artwork —
      // but the generated splash.png has a white ground, so a navy background
      // colour showed as a navy band around it wherever CENTER_CROP didn't
      // reach. Dark mode is handled separately by res/drawable-night/splash.png
      // (white wordmark on navy), which Android picks up automatically.
      backgroundColor: '#FFFFFF',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
    },
  },
};

export default config;

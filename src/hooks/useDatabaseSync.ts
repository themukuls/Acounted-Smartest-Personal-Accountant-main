// src/hooks/useDatabaseSync.ts

import { notifyDatabaseChanged } from '@/utils/dbSync';

/**
 * Signal that stored data changed, from a component.
 *
 * The old `useAutoSync()` hook that used to live here is gone. It installed
 * listeners that pushed a full database export to the legacy WebView bridge —
 * machinery Capacitor doesn't have, and which the repository has made
 * unnecessary: it registers its own flush-on-background handlers, so pending
 * writes are persisted when Android backgrounds the process without any help
 * from the React tree.
 */
export function useDatabaseSync() {
  const triggerSync = () => {
    notifyDatabaseChanged();
  };

  return { triggerSync };
}

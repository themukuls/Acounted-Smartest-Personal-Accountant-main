"use client";

/**
 * BackupPromptContext — when the user is nudged to take a backup.
 *
 * ── What the native app did ──────────────────────────────────────────────────
 *
 * Nothing automatic. `acounted-android` has no WorkManager dependency, no
 * periodic job, no AlarmManager, no `last_backup_at` preference — `AppPrefs`
 * stores only country/currency/intents/dob/ai_enabled. Backup was entirely
 * manual: `BackupScreen` fires a `CreateDocument("text/csv")` picker and
 * `BackupViewModel.exportTo` writes the CSV to whatever Uri the user chose.
 * There is no cadence to copy, so none is invented here — in particular this
 * app does NOT write backup files behind the user's back, because the old one
 * did not and a file appearing unasked is not something a user consented to.
 *
 * ── What this app does ───────────────────────────────────────────────────────
 *
 * It reminds, on the 7-day interval this module has always declared. The
 * reminder had been short-circuited to `false` in every branch, so
 * `vidhence_last_backup_performed_time` was being written and never read and
 * a user could go indefinitely without a backup while the app said nothing.
 * The original logic is restored below; the export itself still only happens
 * when the user taps "Backup Now".
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { useToast } from '@/hooks/use-toast';
import { backupIndexedDB } from '@/integrations/indexeddb/utils/backup';

interface BackupPromptContextType {
  showBackupPrompt: boolean;
  triggerBackup: () => Promise<void>;
  dismissBackupPrompt: () => void;
  recordBackupPerformed: () => void;
}

const BackupPromptContext = createContext<BackupPromptContextType | undefined>(undefined);

/** Remind after a week without a backup, and a week after each "later". */
const BACKUP_INTERVAL_DAYS = 7;
const LAST_BACKUP_TIME_KEY = 'vidhence_last_backup_performed_time';
const LAST_PROMPT_DISMISS_TIME_KEY = 'vidhence_last_prompt_dismiss_time';

const DAY_MS = 1000 * 60 * 60 * 24;
/** Re-evaluate hourly so a long-lived session still crosses the boundary. */
const CHECK_INTERVAL_MS = 1000 * 60 * 60;

const daysSince = (key: string): number | null => {
  const stored = localStorage.getItem(key);
  if (!stored) return null;
  const at = parseInt(stored, 10);
  if (!Number.isFinite(at)) return null;
  return (Date.now() - at) / DAY_MS;
};

export const BackupPromptProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showBackupPrompt, setShowBackupPrompt] = useState(false);

  const checkAndTriggerPrompt = useCallback(() => {
    if (!user) {
      setShowBackupPrompt(false);
      return;
    }

    const sinceBackup = daysSince(LAST_BACKUP_TIME_KEY);
    const sinceDismiss = daysSince(LAST_PROMPT_DISMISS_TIME_KEY);

    // Overdue when there has never been a backup, or the last one has aged out.
    const overdue = sinceBackup === null || sinceBackup >= BACKUP_INTERVAL_DAYS;
    // "Remind me later" buys another full interval of quiet.
    const snoozed = sinceDismiss !== null && sinceDismiss < BACKUP_INTERVAL_DAYS;

    setShowBackupPrompt(overdue && !snoozed);
  }, [user]);

  useEffect(() => {
    checkAndTriggerPrompt();
    const interval = setInterval(checkAndTriggerPrompt, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [checkAndTriggerPrompt]);

  const recordBackupPerformed = useCallback(() => {
    localStorage.setItem(LAST_BACKUP_TIME_KEY, Date.now().toString());
    localStorage.removeItem(LAST_PROMPT_DISMISS_TIME_KEY); // Clear dismiss time on successful backup
    setShowBackupPrompt(false);
  }, []);

  const dismissBackupPrompt = useCallback(() => {
    localStorage.setItem(LAST_PROMPT_DISMISS_TIME_KEY, Date.now().toString());
    setShowBackupPrompt(false);
    toast({
      title: "Reminder dismissed",
      description: `We'll remind you again in ${BACKUP_INTERVAL_DAYS} days.`,
    });
  }, [toast]);

  const triggerBackup = useCallback(async () => {
    if (!user) {
      toast({
        title: "Error",
        description: "You must be logged in to backup data.",
        variant: "destructive",
      });
      return;
    }
    try {
      const result = await backupIndexedDB(user.id);
      recordBackupPerformed(); // Record that backup was performed
      toast({
        title: "Backup Successful",
        description: `${result.filename} saved to ${result.location}.`,
      });
    } catch (error: any) {
      toast({
        title: "Backup Failed",
        description: error.message || "Could not backup your data.",
        variant: "destructive",
      });
    }
  }, [user, toast, recordBackupPerformed]);

  const value = {
    showBackupPrompt,
    triggerBackup,
    dismissBackupPrompt,
    recordBackupPerformed,
  };

  return <BackupPromptContext.Provider value={value}>{children}</BackupPromptContext.Provider>;
};

export const useBackupPrompt = () => {
  const context = useContext(BackupPromptContext);
  if (context === undefined) {
    throw new Error('useBackupPrompt must be used within a BackupPromptProvider');
  }
  return context;
};

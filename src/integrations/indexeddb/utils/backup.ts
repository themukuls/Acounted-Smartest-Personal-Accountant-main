/**
 * backup.ts — the user's backup export.
 *
 * THE OUTPUT IS CSV, NOT JSON. This app is the successor to a native Android
 * app whose backup file is the only migration route real users have, and they
 * move files in both directions: export here, restore there, and back. That
 * only works if both apps speak one format, so the writer lives in
 * `csvBackup.ts` and produces byte-compatible output — same sections, same
 * column order, same `acounted_backup_<stamp>.csv` name the native app used.
 *
 * The JSON export this used to produce (`{ [storeName]: record[] }`,
 * `vidhence_backup_<date>.json`) is gone from the write path. Nothing is
 * stranded: `restore.ts` still reads those files, so a user with an old JSON
 * backup on disk can still restore it — they just get CSV from now on.
 *
 * The download goes through `exportTextFile`, because the
 * `URL.createObjectURL` + anchor trick is a silent no-op inside the Android
 * WebView — i.e. native users could not back up at all.
 */

import { buildCSVBackup, backupFileName } from './csvBackup';
import { exportTextFile, type ExportResult } from '@/lib/fileExport';

export interface BackupOutcome extends ExportResult {
  /** `acounted_backup_<local timestamp>.csv`, for the success toast. */
  filename: string;
}

export async function backupIndexedDB(userId: string): Promise<BackupOutcome> {
  try {
    const csv = await buildCSVBackup(userId);
    const filename = backupFileName();
    const result = await exportTextFile(filename, csv, 'text/csv');
    return { ...result, filename };
  } catch (error) {
    console.error('Error during backup:', error);
    throw new Error('Failed to backup data.');
  }
}

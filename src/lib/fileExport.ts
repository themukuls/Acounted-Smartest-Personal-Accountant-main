/**
 * fileExport.ts — saving a generated file, on the web and on Android.
 *
 * The web app downloads files with `URL.createObjectURL` + an anchor `download`
 * attribute. **That does not work in an Android WebView** — the click is a
 * no-op and the user gets nothing, silently. Since the only way a user can move
 * their data between installs is a backup file, a silent failure here means
 * they cannot back up at all.
 *
 * On native we therefore write the file with @capacitor/filesystem and hand it
 * to the system share sheet, so the user can put it in Drive, WhatsApp, Files,
 * wherever. The file is also left in the Documents folder as a fallback, which
 * is the "folder on the device" the user can find later.
 *
 * ── Why Documents ────────────────────────────────────────────────────────────
 *
 * The native app it replaces pinned no directory at all: `BackupScreen` used
 * `ActivityResultContracts.CreateDocument("text/csv")`, i.e. the Storage Access
 * Framework, so the user picked the folder each time and the app only supplied
 * a suggested filename. There is therefore no legacy path to reproduce.
 * `Directory.Documents` is the closest equivalent — on Android it is the shared,
 * user-visible Documents folder, so backups written here land somewhere the
 * user (and the old app's own file picker) can reach, and they survive the
 * share sheet being dismissed.
 */

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isNative } from '@/lib/platform';

export interface ExportResult {
  /** Where it ended up, for the success toast. */
  location: string;
  /** True when the OS share sheet was shown. */
  shared: boolean;
}

/**
 * Save a text file (JSON or CSV backup, ITR draft, …).
 *
 * @param filename e.g. "acounted_backup_2026-08-01_14-45-48.csv"
 * @param contents the file body
 * @param mimeType e.g. "text/csv" or "application/json"
 */
export async function exportTextFile(
  filename: string,
  contents: string,
  mimeType = 'application/json',
): Promise<ExportResult> {
  if (!isNative()) {
    const blob = new Blob([contents], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return { location: 'Downloads', shared: false };
  }

  // Documents is app-scoped but user-visible in the Files app, so the backup
  // survives even if the user dismisses the share sheet.
  const written = await Filesystem.writeFile({
    path: filename,
    data: contents,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
    recursive: true,
  });

  try {
    const canShare = await Share.canShare();
    if (canShare.value) {
      await Share.share({
        title: filename,
        text: 'Acounted backup',
        url: written.uri,
        dialogTitle: 'Save or send your backup',
      });
      return { location: 'Documents', shared: true };
    }
  } catch {
    // User dismissed the sheet, or no share targets. The file is already
    // written, so this is not a failure worth surfacing as an error.
  }

  return { location: 'Documents', shared: false };
}

/**
 * Read a text file the user picked.
 *
 * `<input type="file">` works inside Capacitor's WebView (the bridge implements
 * onShowFileChooser), so the existing import flow needs no native branch — this
 * helper just centralises the FileReader boilerplate.
 */
export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsText(file);
  });
}

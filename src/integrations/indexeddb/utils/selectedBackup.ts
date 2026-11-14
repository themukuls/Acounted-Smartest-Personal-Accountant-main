import { STORE_NAMES } from '@/integrations/storage/stores';
import { parseCSVBackupFile, type CSVBackupData } from './csvRestore';

export type SelectedBackup =
  | { kind: 'csv'; data: CSVBackupData }
  | { kind: 'json'; data: Record<string, unknown[]> };

function parseLegacyJSONBackup(text: string): Record<string, unknown[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('The selected file is neither a valid Acounted CSV nor a valid JSON backup.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('This JSON file is not in Acounted backup format.');
  }

  const candidate = parsed as Record<string, unknown>;
  const includedStores = STORE_NAMES.filter((name) =>
    Object.prototype.hasOwnProperty.call(candidate, name),
  );
  if (includedStores.length === 0 || includedStores.some((name) => !Array.isArray(candidate[name]))) {
    throw new Error('This JSON file is not in Acounted backup format.');
  }

  return candidate as Record<string, unknown[]>;
}

/**
 * Detect backup type from content after selection. No file-name extension or
 * MIME check belongs here: Android document providers report CSVs
 * inconsistently, and picker filtering must not prevent the user selecting one.
 */
export function parseSelectedBackupText(text: string): SelectedBackup {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('The selected file is empty.');

  try {
    return { kind: 'csv', data: parseCSVBackupFile(text) };
  } catch (csvError) {
    if (trimmed.startsWith('{')) {
      return { kind: 'json', data: parseLegacyJSONBackup(text) };
    }
    throw csvError;
  }
}

export async function readSelectedBackupFile(file: Pick<File, 'text'>): Promise<SelectedBackup> {
  return parseSelectedBackupText(await file.text());
}

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseSelectedBackupText } from './selectedBackup';

const CSV_FIXTURE = readFileSync(
  fileURLToPath(new URL('../../../test-fixtures/legacy-android-backup.csv', import.meta.url)),
  'utf8',
);

describe('selected backup content detection', () => {
  test('recognises Acounted CSV by contents', () => {
    const selected = parseSelectedBackupText(CSV_FIXTURE);
    expect(selected.kind).toBe('csv');
  });

  test('keeps support for legacy JSON backups', () => {
    const selected = parseSelectedBackupText(JSON.stringify({ transactions: [] }));
    expect(selected).toEqual({ kind: 'json', data: { transactions: [] } });
  });

  test('rejects unrelated JSON', () => {
    expect(() => parseSelectedBackupText('{"hello":"world"}')).toThrow(
      'not in Acounted backup format',
    );
  });
});

/**
 * loaderLines.test.ts — the cold-start copy pool.
 *
 * Run with:  npx --yes bun@latest test src/lib
 *
 * The picker is small but it runs on every single app launch, so the two things
 * that would actually be noticed — the same line twice running, and a line too
 * long to read before the app is ready — are pinned here.
 */

import { test, expect, describe } from 'bun:test';
import { LOADER_LINES, pickLine, SLOW_LOAD_LINE, type LoaderLine } from './loaderLines';

const POOL: LoaderLine[] = [
  { group: 'saving', text: 'one' },
  { group: 'saving', text: 'two' },
  { group: 'tax', text: 'three' },
];

describe('pickLine', () => {
  test('returns a line from the pool', () => {
    const line = pickLine(POOL, null, () => 0);
    expect(POOL).toContain(line);
  });

  test('never repeats the previous line', () => {
    // Exhaustive rather than sampled: for every possible previous line, drive
    // the picker across the whole random range and assert it never comes back.
    for (const previous of POOL) {
      for (let r = 0; r < 1; r += 0.05) {
        expect(pickLine(POOL, previous.text, () => r).text).not.toBe(previous.text);
      }
    }
  });

  test('a previous line that is not in the pool is ignored', () => {
    const line = pickLine(POOL, 'a line from an older release', () => 0);
    expect(line.text).toBe('one');
  });

  test('falls back rather than throwing when the pool is a single line', () => {
    const single = [POOL[0]];
    expect(pickLine(single, 'one', () => 0.99).text).toBe('one');
  });

  test('rand() returning exactly 1 does not index past the end', () => {
    // Math.random() never returns 1, but an injected or patched source might.
    expect(() => pickLine(POOL, null, () => 1)).not.toThrow();
    expect(POOL).toContain(pickLine(POOL, null, () => 1));
  });

  test('throws on an empty pool rather than returning undefined', () => {
    expect(() => pickLine([], null)).toThrow();
  });

  test('reaches every line in the pool', () => {
    const seen = new Set<string>();
    for (let r = 0; r < 1; r += 0.01) seen.add(pickLine(POOL, null, () => r).text);
    expect(seen.size).toBe(POOL.length);
  });
});

describe('the shipped copy', () => {
  test('every line is short enough to read before the app is ready', () => {
    // Ten words is the budget — beyond that the loader dismisses mid-sentence.
    for (const line of LOADER_LINES) {
      const words = line.text.trim().split(/\s+/).length;
      expect(words).toBeLessThanOrEqual(10);
    }
    expect(SLOW_LOAD_LINE.trim().split(/\s+/).length).toBeLessThanOrEqual(10);
  });

  test('no line scolds, lectures or shouts', () => {
    // Same guard as the reminder nudges: launch copy that moralises about money
    // is the fastest way to make someone resent opening the app.
    const banned = /\b(should|must|overspent|too much|failed|bad|stop)\b|!/i;
    for (const line of LOADER_LINES) {
      expect(line.text).not.toMatch(banned);
    }
    expect(SLOW_LOAD_LINE).not.toMatch(banned);
  });

  test('there are no duplicate lines', () => {
    const texts = LOADER_LINES.map((l) => l.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  test('the pool is big enough for launches not to feel repetitive', () => {
    expect(LOADER_LINES.length).toBeGreaterThanOrEqual(12);
  });

  test('every active themed group is represented and dormant Tax copy is excluded', () => {
    const groups = new Set(LOADER_LINES.map((l) => l.group));
    for (const g of ['awareness', 'saving', 'accountant', 'privacy']) {
      expect(groups.has(g as LoaderLine['group'])).toBe(true);
    }
    expect(groups.has('tax')).toBe(false);
  });
});

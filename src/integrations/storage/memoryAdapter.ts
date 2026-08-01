/**
 * memoryAdapter.ts — a StorageAdapter backed by a Map.
 *
 * Two jobs:
 *  1. The last-resort fallback when OPFS is unavailable (private browsing,
 *     ancient WebViews). Data is lost on reload, but the app runs instead of
 *     white-screening.
 *  2. The substrate for repository.test.ts. It can count operations (so we can
 *     prove the debounce coalesces N puts into ONE write) and inject faults
 *     (so we can prove a crash between the tmp-write and the rename leaves the
 *     previous generation of the file intact).
 */

import type { StorageAdapter } from './adapter';

export type StorageOp = 'read' | 'write' | 'rename' | 'remove' | 'exists';

/** Throw from this hook to simulate a filesystem failure. */
export type FaultHook = (op: StorageOp, name: string) => void;

export interface MemoryAdapter extends StorageAdapter {
  /** Raw backing store. Readable and writable by tests. */
  readonly files: Map<string, string>;
  /** How many times each operation has been invoked since the last reset. */
  readonly counts: Record<StorageOp, number>;
  /** Per-file write counter — the precise assertion for debounce coalescing. */
  readonly writeCounts: Map<string, number>;
  /** Put a file in place without going through `write` (no counters, no faults). */
  seed(name: string, contents: string): void;
  /** Install (or clear, with `null`) the fault hook. */
  setFault(hook: FaultHook | null): void;
  /** Zero the counters. */
  resetCounts(): void;
  /** Drop every file and counter. */
  reset(): void;
}

export function createMemoryAdapter(): MemoryAdapter {
  const files = new Map<string, string>();
  const writeCounts = new Map<string, number>();
  const counts: Record<StorageOp, number> = {
    read: 0,
    write: 0,
    rename: 0,
    remove: 0,
    exists: 0,
  };
  let fault: FaultHook | null = null;

  function enter(op: StorageOp, name: string): void {
    counts[op] += 1;
    if (fault) fault(op, name);
  }

  const adapter: MemoryAdapter = {
    files,
    counts,
    writeCounts,

    async read(name: string): Promise<string | null> {
      enter('read', name);
      const value = files.get(name);
      return value === undefined ? null : value;
    },

    async write(name: string, contents: string): Promise<void> {
      enter('write', name);
      files.set(name, contents);
      writeCounts.set(name, (writeCounts.get(name) ?? 0) + 1);
    },

    async rename(from: string, to: string): Promise<void> {
      enter('rename', from);
      const value = files.get(from);
      if (value === undefined) {
        throw new Error(`memoryAdapter.rename: source "${from}" does not exist`);
      }
      files.set(to, value);
      files.delete(from);
    },

    async remove(name: string): Promise<void> {
      enter('remove', name);
      files.delete(name);
    },

    async exists(name: string): Promise<boolean> {
      enter('exists', name);
      return files.has(name);
    },

    seed(name: string, contents: string): void {
      files.set(name, contents);
    },

    setFault(hook: FaultHook | null): void {
      fault = hook;
    },

    resetCounts(): void {
      counts.read = 0;
      counts.write = 0;
      counts.rename = 0;
      counts.remove = 0;
      counts.exists = 0;
      writeCounts.clear();
    },

    reset(): void {
      files.clear();
      adapter.resetCounts();
      fault = null;
    },
  };

  return adapter;
}

/**
 * Process-wide fallback instance. Shared on purpose — if OPFS is missing we
 * still want every call site in the app to see the same (volatile) data.
 */
export const memoryAdapter: MemoryAdapter = createMemoryAdapter();

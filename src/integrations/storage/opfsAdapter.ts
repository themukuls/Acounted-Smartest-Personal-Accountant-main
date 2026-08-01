/**
 * opfsAdapter.ts — storage for browser dev (`npm run dev`) and the PWA.
 *
 * Uses the Origin Private File System (`navigator.storage.getDirectory()`),
 * deliberately modelled as the same flat folder-of-files as the native
 * adapter. One code path, one set of filenames, one atomic-write algorithm in
 * repository.ts — a bug reproduced in the browser is the same bug that ships.
 *
 * The DOM lib typings for OPFS vary by TypeScript version, so the handful of
 * shapes we touch are declared locally and reached through one cast. That is
 * cheaper and more stable than depending on whichever lib.dom happens to be
 * installed.
 */

import type { StorageAdapter } from './adapter';
import { memoryAdapter } from './memoryAdapter';

/** Folder inside the OPFS root that holds every store file. */
const FOLDER = 'acounted';

interface OpfsWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

interface OpfsFileHandle {
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<OpfsWritable>;
}

interface OpfsDirHandle {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OpfsDirHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

interface OpfsCapableStorage {
  getDirectory?: () => Promise<OpfsDirHandle>;
}

function opfsRoot(): (() => Promise<OpfsDirHandle>) | null {
  if (typeof navigator === 'undefined') return null;
  const storage = (navigator as unknown as { storage?: OpfsCapableStorage }).storage;
  if (!storage || typeof storage.getDirectory !== 'function') return null;
  return () => (storage.getDirectory as () => Promise<OpfsDirHandle>)();
}

function isNotFound(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'NotFoundError';
}

export function createOpfsAdapter(): StorageAdapter {
  const detected = opfsRoot();

  if (!detected) {
    console.warn(
      '[storage] Origin Private File System is unavailable in this browser — ' +
        'falling back to in-memory storage. Data will NOT survive a reload.',
    );
    return memoryAdapter;
  }

  const getRoot: () => Promise<OpfsDirHandle> = detected;

  // Cached so we don't walk the root on every single operation.
  let dirPromise: Promise<OpfsDirHandle> | null = null;

  function dir(): Promise<OpfsDirHandle> {
    if (!dirPromise) {
      dirPromise = getRoot()
        .then((root) => root.getDirectoryHandle(FOLDER, { create: true }))
        .catch((err) => {
          // Don't poison the cache — a transient failure should be retryable.
          dirPromise = null;
          throw err;
        });
    }
    return dirPromise;
  }

  async function readOrNull(name: string): Promise<string | null> {
    try {
      const handle = await (await dir()).getFileHandle(name);
      const file = await handle.getFile();
      return await file.text();
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async function writeText(name: string, contents: string): Promise<void> {
    const handle = await (await dir()).getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(contents);
    } finally {
      await writable.close();
    }
  }

  return {
    read: readOrNull,

    write: writeText,

    async rename(from: string, to: string): Promise<void> {
      // OPFS has no rename/move primitive, so it is emulated as
      // read + write + delete. This is NOT atomic — which is precisely why
      // repository.ts also keeps a `.bak` generation rather than trusting the
      // rename alone. On native the rename really is atomic; on the web the
      // backup is what saves us.
      const contents = await readOrNull(from);
      if (contents === null) {
        throw new Error(`opfsAdapter.rename: source "${from}" does not exist`);
      }
      await writeText(to, contents);
      try {
        await (await dir()).removeEntry(from);
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    },

    async remove(name: string): Promise<void> {
      try {
        await (await dir()).removeEntry(name);
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    },

    async exists(name: string): Promise<boolean> {
      try {
        await (await dir()).getFileHandle(name);
        return true;
      } catch (err) {
        if (isNotFound(err)) return false;
        throw err;
      }
    },
  };
}

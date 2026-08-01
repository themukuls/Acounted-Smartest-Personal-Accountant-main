/**
 * capacitorFileAdapter.ts — production storage on Android/iOS.
 *
 * Files live under `Directory.Data/acounted/`. `Directory.Data` is the app's
 * private data directory: it is not visible in the gallery or a file manager,
 * it is not backed up to the media store, and it is removed when the user
 * uninstalls the app. That is exactly the lifetime we want for a personal
 * finance ledger.
 *
 * The @capacitor/filesystem plugin is imported lazily. A static import would
 * pull the plugin (and @capacitor/core's plugin registry) into every bundle
 * and every unit-test process, which is both wasteful and a source of
 * environment-dependent import failures.
 */

import type { StorageAdapter } from './adapter';

/** Folder inside Directory.Data that holds every store file. */
const FOLDER = 'acounted';

type FilesystemModule = typeof import('@capacitor/filesystem');

let modulePromise: Promise<FilesystemModule> | null = null;

function loadFilesystem(): Promise<FilesystemModule> {
  if (!modulePromise) {
    modulePromise = import('@capacitor/filesystem');
  }
  return modulePromise;
}

function pathFor(name: string): string {
  return `${FOLDER}/${name}`;
}

async function blobToText(data: Blob): Promise<string> {
  if (typeof data.text === 'function') return data.text();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(data);
  });
}

export function createCapacitorFileAdapter(): StorageAdapter {
  // The directory only has to be created once per process. We keep the promise
  // so concurrent first writes don't race into duplicate mkdir calls.
  let ensureDirPromise: Promise<void> | null = null;

  async function ensureDir(): Promise<void> {
    if (!ensureDirPromise) {
      ensureDirPromise = (async () => {
        const { Filesystem, Directory } = await loadFilesystem();
        try {
          await Filesystem.mkdir({
            path: FOLDER,
            directory: Directory.Data,
            recursive: true,
          });
        } catch {
          // "Directory exists" is the overwhelmingly common case and the plugin
          // signals it by throwing. Any genuinely fatal problem (no permission,
          // no space) will resurface on the very next write, with a better
          // message, so swallowing here costs us nothing.
        }
      })();
    }
    return ensureDirPromise;
  }

  return {
    async read(name: string): Promise<string | null> {
      const { Filesystem, Directory, Encoding } = await loadFilesystem();
      try {
        const result = await Filesystem.readFile({
          path: pathFor(name),
          directory: Directory.Data,
          encoding: Encoding.UTF8,
        });
        const data = result.data;
        return typeof data === 'string' ? data : await blobToText(data);
      } catch {
        // Filesystem throws for a missing file. The StorageAdapter contract is
        // `null` for absence — a missing store file is the normal first-run
        // state, not an error, and callers must not have to distinguish.
        return null;
      }
    },

    async write(name: string, contents: string): Promise<void> {
      await ensureDir();
      const { Filesystem, Directory, Encoding } = await loadFilesystem();
      await Filesystem.writeFile({
        path: pathFor(name),
        data: contents,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
        recursive: true,
      });
    },

    async rename(from: string, to: string): Promise<void> {
      await ensureDir();
      const { Filesystem, Directory } = await loadFilesystem();
      await Filesystem.rename({
        from: pathFor(from),
        to: pathFor(to),
        directory: Directory.Data,
        toDirectory: Directory.Data,
      });
    },

    async remove(name: string): Promise<void> {
      const { Filesystem, Directory } = await loadFilesystem();
      try {
        await Filesystem.deleteFile({
          path: pathFor(name),
          directory: Directory.Data,
        });
      } catch {
        // Idempotent by contract: deleting something that isn't there is fine.
      }
    },

    async exists(name: string): Promise<boolean> {
      const { Filesystem, Directory } = await loadFilesystem();
      try {
        await Filesystem.stat({
          path: pathFor(name),
          directory: Directory.Data,
        });
        return true;
      } catch {
        return false;
      }
    },
  };
}

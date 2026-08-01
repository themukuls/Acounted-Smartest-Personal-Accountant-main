/**
 * restore.ts — reads a `backup.ts` JSON file back into the repository.
 *
 * Backward compatibility is the whole job here. Files written by the original
 * 13-store backup are still out there, so the restore is driven by the keys the
 * FILE actually contains, not by the full store catalogue: a store absent from
 * the file is left completely untouched. That keeps an old 13-key file behaving
 * exactly as it always did (those 13 keys are always present in files the old
 * backup produced) while letting a new 23-key file restore everything, and it
 * means a partial file can never silently wipe the stores it does not mention.
 *
 * The old implementation cleared a user's rows with the codebase's only
 * IndexedDB cursor — a cursor opened on the `user_id` index, bounded to this
 * user, collecting each row's primary key to delete. That is replaced below by
 * an index read followed by a keyed delete per row: the same set of rows,
 * identified the same way, with other users' rows untouched.
 */

import {
  get,
  getAllByIndex,
  put,
  remove,
} from '@/integrations/storage/repository';
import { STORE_NAMES, keyFieldFor } from '@/integrations/storage/stores';

export async function restoreIndexedDB(userId: string, backupData: { [storeName: string]: any[] }): Promise<void> {
  try {
    // Only the stores this backup file actually carries.
    const storeNames = STORE_NAMES.filter(
      (name) => Object.prototype.hasOwnProperty.call(backupData, name),
    );

    for (const storeName of storeNames) {
      const dataToRestore = backupData[storeName] || [];

      if (storeName === 'profiles') {
        // Special handling for profiles: update existing user's profile, don't add new
        const backupProfile = dataToRestore.find(p => p.id === userId);
        if (backupProfile) {
          // Fetch current user's profile
          const currentUserProfile = await get<Record<string, any>>('profiles', userId);
          if (currentUserProfile) {
            // Update only safe fields — never overwrite pin_hash or email from backup
            const updatedProfile = {
              ...currentUserProfile,
              display_name: backupProfile.display_name ?? backupProfile.first_name ?? '',
              phone: backupProfile.phone,
              onboarding_completed: backupProfile.onboarding_completed,
              updated_at: new Date().toISOString(),
            };
            await put('profiles', updatedProfile);
            console.log(`Restore: Updated profile for user ${userId}`);
          } else {
            console.warn(`Restore: Profile for current user ${userId} not found during restore. Skipping profile update.`);
          }
        }
      } else {
        // For other stores, clear existing data for the user and then add new data.
        // (Was a cursor over the `user_id` index collecting primary keys.)
        const keyField = keyFieldFor(storeName);
        const existingRows = await getAllByIndex<Record<string, any>>(storeName, 'user_id', userId);
        const keysToDelete = existingRows.map((row) => row[keyField] as string);
        for (const key of keysToDelete) {
          await remove(storeName, key);
        }
        console.log(`Restore: Cleared ${keysToDelete.length} records from ${storeName} for user ${userId}`);

        for (const record of dataToRestore) {
          // Ensure the user_id matches the current logged-in user's ID
          // This is important if the backup was from a different user or if IDs somehow got mixed
          const recordWithCorrectUserId = { ...record, user_id: userId };
          await put(storeName, recordWithCorrectUserId);
        }
        console.log(`Restore: Added ${dataToRestore.length} records to ${storeName} for user ${userId}`);
      }
    }

    console.log('Restore successful!');
  } catch (error) {
    console.error('Error during restore:', error);
    throw new Error('Failed to restore data.');
  }
}

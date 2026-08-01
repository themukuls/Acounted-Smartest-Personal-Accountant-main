import type { MyDB } from '@/integrations/indexeddb/db';
import { bulkPut, getAllByIndex, put } from '@/integrations/storage/repository';
import { parseISO, isBefore, format } from 'date-fns';
import { convertToIST, getISTDate } from '@/lib/date-utils';

export interface Notification {
  id: string;
  date: Date; // Stored as Date object after parsing
  heading: string;
  text: string;
}

// Directly reference the notification.txt file in the public directory
const NOTIFICATION_FILE_PATH = '/notification.txt';

/**
 * Fetches the notification.txt file and parses its content into Notification objects.
 * @returns An array of parsed Notification objects.
 */
async function fetchAndParseNotifications(): Promise<Notification[]> {
  try {
    console.log(`[notificationService] Attempting to fetch: ${NOTIFICATION_FILE_PATH}`);
    const response = await fetch(NOTIFICATION_FILE_PATH);
    console.log(`[notificationService] Fetch response status: ${response.status}`);
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[notificationService] Fetch failed: ${response.statusText}, Body: ${errorText}`);
      throw new Error(`Failed to fetch notifications: ${response.statusText}`);
    }
    const text = await response.text();
    console.log(`[notificationService] Fetched text content (first 200 chars):`, text.substring(0, 200) + '...'); // Log first 200 chars
    return parseNotificationText(text);
  } catch (error) {
    console.error("[notificationService] Error fetching or parsing notifications:", error);
    return [];
  }
}

/**
 * Parses the raw text content of notification.txt into an array of Notification objects.
 * @param text The raw content of notification.txt.
 * @returns An array of parsed Notification objects.
 */
function parseNotificationText(text: string): Notification[] {
  const notifications: Notification[] = [];
  const blocks = text.split('---').map(block => block.trim()).filter(block => block.length > 0);
  console.log(`[notificationService] Found ${blocks.length} notification blocks.`);

  blocks.forEach((block, blockIndex) => {
    const lines = block.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    let id: string | undefined;
    let dateString: string | undefined;
    let heading: string | undefined;
    let textContent: string[] = [];

    lines.forEach(line => {
      if (line.startsWith('ID:')) {
        id = line.substring(3).trim();
      } else if (line.startsWith('DATE:')) {
        dateString = line.substring(5).trim();
      } else if (line.startsWith('HEADING:')) {
        heading = line.substring(8).trim();
      } else if (line.startsWith('TEXT:')) {
        textContent.push(line.substring(5).trim());
      } else {
        // Continue adding to text content if it's not a new field
        if (textContent.length > 0) {
          textContent.push(line);
        }
      }
    });

    if (id && dateString && heading && textContent.length > 0) {
      try {
        // Convert the date string to an IST Date object for consistent comparison
        const notificationDate = convertToIST(parseISO(dateString.replace(' IST', '')));
        console.log(`[notificationService] Parsed notification ${id}: Date: ${dateString} -> ${format(notificationDate, 'yyyy-MM-dd HH:mm:ss')} IST`);
        notifications.push({
          id,
          date: notificationDate,
          heading,
          text: textContent.join('\n'),
        });
      } catch (e) {
        console.error(`[notificationService] Error parsing date for notification ID ${id}:`, e);
      }
    } else {
      console.warn(`[notificationService] Skipping malformed block ${blockIndex}. Missing ID, DATE, HEADING, or TEXT.`);
    }
  });

  return notifications;
}

/**
 * Retrieves all active notifications (whose date is on or before the current IST date).
 * @returns An array of active Notification objects.
 */
export async function getActiveNotifications(): Promise<Notification[]> {
  const allNotifications = await fetchAndParseNotifications();
  const currentISTDate = getISTDate(); // Get current date in IST
  console.log(`[notificationService] Current IST Date for filtering: ${format(currentISTDate, 'yyyy-MM-dd HH:mm:ss')} IST`);

  const active = allNotifications.filter(notif => 
    isBefore(notif.date, currentISTDate) || notif.date.toDateString() === currentISTDate.toDateString()
  ).sort((a, b) => b.date.getTime() - a.date.getTime()); // Sort by date descending

  console.log(`[notificationService] Found ${active.length} active notifications.`);
  return active;
}

/**
 * Fetches the IDs of notifications that a specific user has marked as seen.
 * @param userId The ID of the user.
 * @returns A Set of seen notification IDs.
 */
export async function getSeenNotificationIds(userId: string): Promise<Set<string>> {
  const seenRecords = await getAllByIndex<MyDB['user_notifications']['value']>(
    'user_notifications', 'user_id', userId,
  );
  return new Set(seenRecords.map(record => record.notification_id));
}

/**
 * Marks a specific notification as seen by a user in IndexedDB.
 * @param userId The ID of the user.
 * @param notificationId The ID of the notification to mark as seen.
 */
export async function markNotificationAsSeen(userId: string, notificationId: string): Promise<void> {
  const now = new Date().toISOString();
  const recordToSave: MyDB['user_notifications']['value'] = {
    user_id: userId,
    notification_id: notificationId,
    seen_at: now,
  };

  await put('user_notifications', recordToSave); // upsert: update if exists, add if new
}

/**
 * Marks multiple notifications as seen by a user.
 * @param userId The ID of the user.
 * @param notificationIds An array of notification IDs to mark as seen.
 */
export async function markNotificationsAsSeen(userId: string, notificationIds: string[]): Promise<void> {
  const now = new Date().toISOString();

  const records: MyDB['user_notifications']['value'][] = notificationIds.map(notificationId => ({
    user_id: userId,
    notification_id: notificationId,
    seen_at: now,
  }));
  await bulkPut('user_notifications', records);
}
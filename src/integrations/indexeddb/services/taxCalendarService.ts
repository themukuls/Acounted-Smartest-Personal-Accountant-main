import type { MyDB } from '../db';
import { getAllByIndex, put } from '@/integrations/storage/repository';
import { v4 as uuidv4 } from 'uuid';

type CalendarState = MyDB['tax_calendar_state']['value'];

/** Get the set of ticked event IDs for a given user + FY */
export async function getCalendarState(
  userId: string,
  financialYear: string,
): Promise<Set<string>> {
  try {
    const all = await getAllByIndex<CalendarState>('tax_calendar_state', 'user_id', userId);
    const record = all.find(r => r.financial_year === financialYear);
    return record ? new Set(record.checked_event_ids) : new Set();
  } catch {
    return new Set();
  }
}

/** Save the full set of ticked event IDs for a user + FY */
export async function saveCalendarState(
  userId: string,
  financialYear: string,
  checkedIds: Set<string>,
): Promise<void> {
  try {
    const all = await getAllByIndex<CalendarState>('tax_calendar_state', 'user_id', userId);
    const existing = all.find(r => r.financial_year === financialYear);
    const now = new Date().toISOString();

    if (existing) {
      await put('tax_calendar_state', { ...existing, checked_event_ids: [...checkedIds], updated_at: now });
    } else {
      await put('tax_calendar_state', {
        id: uuidv4(), user_id: userId, financial_year: financialYear,
        checked_event_ids: [...checkedIds], updated_at: now,
      });
    }
  } catch (e) {
    console.warn('[taxCalendarService] save failed:', e);
  }
}

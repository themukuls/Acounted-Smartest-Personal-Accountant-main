import { format } from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { startOfWeek, endOfWeek, addDays, isWithinInterval, differenceInDays, max, min, startOfDay } from "date-fns";

const IST_TIMEZONE = "Asia/Kolkata";

export const getISTDate = (): Date => {
  return toZonedTime(new Date(), IST_TIMEZONE);
};

export const formatToIST = (date: Date | string, formatString: string = "yyyy-MM-dd HH:mm:ss"): string => {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  const istDate = toZonedTime(dateObj, IST_TIMEZONE);
  return format(istDate, formatString);
};

export const getISTDateTimeLocal = (): string => {
  const istDate = getISTDate();
  return format(istDate, "yyyy-MM-dd'T'HH:mm");
};

export const convertToIST = (utcDate: string | Date): Date => {
  const dateObj = typeof utcDate === "string" ? new Date(utcDate) : utcDate;
  return toZonedTime(dateObj, IST_TIMEZONE);
};

export const getCurrentISTMonth = (): string => {
  const istDate = getISTDate();
  return `${istDate.getFullYear()}-${(istDate.getMonth() + 1).toString().padStart(2, '0')}`;
};

export const getMonthsInIST = (monthsBack: number = 24): Array<{value: string, label: string}> => {
  const months = [];
  const now = getISTDate();
  
  for (let i = 0; i < monthsBack; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const istDate = toZonedTime(date, IST_TIMEZONE);
    const value = `${istDate.getFullYear()}-${(istDate.getMonth() + 1).toString().padStart(2, '0')}`;
    const label = format(istDate, "MMMM yyyy");
    months.push({ value, label });
  }
  
  return months.sort((a, b) => a.value.localeCompare(b.value)); // Sort chronologically
};

export const getBudgetMonthsInIST = (): Array<{value: string, label: string}> => {
  const months = [];
  const now = getISTDate();
  
  // Get last 3 months, current month, and next 3 months (7 months total)
  for (let i = -3; i <= 3; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const istDate = toZonedTime(date, IST_TIMEZONE);
    const value = `${istDate.getFullYear()}-${(istDate.getMonth() + 1).toString().padStart(2, '0')}`;
    const label = format(istDate, "MMMM yyyy");
    months.push({ value, label });
  }
  
  return months.sort((a, b) => a.value.localeCompare(b.value)); // Sort chronologically
};

/**
 * Generates an array of week objects within a given date range.
 * Each week object includes its start date, end date, and a formatted label.
 * Weeks start on Monday (1).
 * @param rangeStartDate The start date of the overall range.
 * @param rangeEndDate The end date of the overall range.
 * @returns An array of week objects.
 */
export const getWeeksInDateRange = (
  rangeStartDate: Date,
  rangeEndDate: Date
): Array<{ start: Date; end: Date; label: string; daysInWeek: number }> => {
  const weeks = [];
  // Normalize to end of day so transactions on the last day of the range
  // (e.g. 30th or 31st of month) are always included in the final week
  const normalizedEndDate = new Date(rangeEndDate.getFullYear(), rangeEndDate.getMonth(), rangeEndDate.getDate(), 23, 59, 59, 999);
  let currentWeekStart = startOfDay(startOfWeek(rangeStartDate, { weekStartsOn: 1 }));

  // Adjust currentWeekStart to not go before rangeStartDate
  if (currentWeekStart < rangeStartDate) {
    currentWeekStart = rangeStartDate;
  }

  while (currentWeekStart <= normalizedEndDate) {
    let currentWeekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 });

    // Clamp to end of the range (normalized to 23:59:59.999)
    if (currentWeekEnd > normalizedEndDate) {
      currentWeekEnd = normalizedEndDate;
    }

    const label = `${format(currentWeekStart, 'MMM dd')} - ${format(currentWeekEnd, 'MMM dd')}`;
    const daysInWeek = differenceInDays(currentWeekEnd, currentWeekStart) + 1;

    weeks.push({ start: currentWeekStart, end: currentWeekEnd, label, daysInWeek });
    console.log(`[getWeeksInDateRange] Generated week: ${label}, Start: ${format(currentWeekStart, 'yyyy-MM-dd HH:mm:ss')}, End: ${format(currentWeekEnd, 'yyyy-MM-dd HH:mm:ss')}`);


    // Move to the start of the next week, ensuring it's 00:00:00
    currentWeekStart = startOfDay(addDays(currentWeekEnd, 1)); // FIX: Apply startOfDay directly to the result of addDays
  }
  return weeks;
};

/**
 * Calculates the current Financial Year (FY) based on the system date.
 * FY is April 1st to March 31st.
 * @returns A string representing the current FY (e.g., "2025-26").
 */
export const getCurrentFinancialYear = (): string => {
  const now = new Date();
  const currentMonth = now.getMonth(); // 0-indexed (0 for Jan, 3 for Apr)
  const currentYear = now.getFullYear();

  if (currentMonth >= 3) { // April (3) to December (11)
    return `${currentYear}-${(currentYear + 1).toString().slice(-2)}`;
  } else { // January (0) to March (2)
    return `${currentYear - 1}-${currentYear.toString().slice(-2)}`;
  }
};

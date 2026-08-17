import type { UsagePeriod } from '../types/usage';

/**
 * Returns date in YYYY-MM-DD format (UTC).
 */
export function getUtcDateString(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Returns date range (startDate, endDate) in YYYY-MM-DD for a given usage period.
 */
export function getDateRangeForPeriod(period: UsagePeriod): { startDate: string; endDate: string } {
  const now = new Date();
  const endDate = getUtcDateString(now);

  if (period === 'today') {
    return { startDate: endDate, endDate };
  }

  if (period === '7d') {
    const start = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    return { startDate: getUtcDateString(start), endDate };
  }

  if (period === '30d') {
    const start = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
    return { startDate: getUtcDateString(start), endDate };
  }

  if (period === 'current_month') {
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const startDate = `${year}-${month}-01`;
    return { startDate, endDate };
  }

  if (period === 'previous_month') {
    const year = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
    const prevMonthIdx = now.getUTCMonth() === 0 ? 11 : now.getUTCMonth() - 1;
    const month = String(prevMonthIdx + 1).padStart(2, '0');
    const startDate = `${year}-${month}-01`;
    // Last day of previous month
    const lastDay = new Date(Date.UTC(year, prevMonthIdx + 1, 0)).getUTCDate();
    const prevEndDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
    return { startDate, endDate: prevEndDate };
  }

  return { startDate: endDate, endDate };
}

/**
 * Generates an array of all date strings (YYYY-MM-DD) between startDate and endDate inclusive.
 */
export function getDatesBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const curr = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  while (curr <= end) {
    dates.push(getUtcDateString(curr));
    curr.setUTCDate(curr.getUTCDate() + 1);
  }

  return dates;
}

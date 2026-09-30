// Çelimeluk - Date Utilities (Local Timezone Safe)

/**
 * Returns the local date formatted as YYYY-MM-DD.
 * Avoids Date.prototype.toISOString() which returns UTC and causes
 * a 3-hour mismatch (yesterday's date) between 00:00 and 03:00 in UTC+3 (Turkey).
 */
export function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns the difference in calendar days between two YYYY-MM-DD date strings (d2 - d1).
 */
export function getDaysBetweenDates(d1Str, d2Str) {
  if (!d1Str || !d2Str) return 999;
  const [y1, m1, d1] = d1Str.split('-').map(Number);
  const [y2, m2, d2] = d2Str.split('-').map(Number);
  const a = new Date(y1, m1 - 1, d1);
  const b = new Date(y2, m2 - 1, d2);
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

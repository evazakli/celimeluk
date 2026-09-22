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

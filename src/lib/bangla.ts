/**
 * Bangla (Bangabda) year of a date. The year starts on 14 April (Pohela Boishakh),
 * so 14 Apr 2026 – 13 Apr 2027 is 1433.
 */
export function banglaYear(date: Date): string {
  const y = date.getUTCFullYear();
  const beforeNewYear = date.getUTCMonth() < 3 || (date.getUTCMonth() === 3 && date.getUTCDate() < 14);
  return String(y - (beforeNewYear ? 594 : 593));
}

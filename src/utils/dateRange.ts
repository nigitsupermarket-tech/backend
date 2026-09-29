// backend/src/utils/dateRange.ts
//
// Business-day boundaries for reports and POS listings. The business
// operates in Nigeria (WAT, UTC+1, no DST) but the server usually runs in
// UTC, so `new Date("2026-09-27")` + `setHours(...)` cut days at 01:00 WAT
// instead of midnight, and a single-day range (from === to) collapsed to a
// zero-width window. Everything date-related for "a day" goes through here.

const WAT_OFFSET = "+01:00";
const WAT_OFFSET_MS = 60 * 60 * 1000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

// Accepts "YYYY-MM-DD" (what <input type="date"> sends) or a full ISO string
// (only its date part is used). Returns null when unparseable.
export function normalizeYmd(value?: string | null): string | null {
  if (!value) return null;
  const ymd = String(value).trim().slice(0, 10);
  if (!YMD.test(ymd)) return null;
  return isNaN(new Date(`${ymd}T00:00:00.000${WAT_OFFSET}`).getTime())
    ? null
    : ymd;
}

export function startOfDayWAT(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000${WAT_OFFSET}`);
}

export function endOfDayWAT(ymd: string): Date {
  return new Date(`${ymd}T23:59:59.999${WAT_OFFSET}`);
}

// Today's calendar date in WAT as YYYY-MM-DD.
export function todayYmdWAT(now: Date = new Date()): string {
  return new Date(now.getTime() + WAT_OFFSET_MS).toISOString().slice(0, 10);
}

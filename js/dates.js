/** Date helpers */

import { DOW } from './constants.js';

export function pad(n) {
  return String(n).padStart(2, '0');
}

export function toYmd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function startOfMonth(y, m) {
  return new Date(y, m, 1);
}

export function endOfMonth(y, m) {
  return new Date(y, m + 1, 0, 23, 59, 59, 999);
}

export function formatMonthLabel(y, m) {
  return `${y}年 ${m + 1}月`;
}

export function formatSelectedLabel(ymd) {
  const d = parseYmd(ymd);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${DOW[d.getDay()]}）`;
}

export function formatEventTime(ev) {
  if (ev.allDay) return '終日';
  const s = new Date(ev.start);
  const e = new Date(ev.end);
  const f = (x) => `${pad(x.getHours())}:${pad(x.getMinutes())}`;
  // Multi-day timed: show date prefix on end if different day
  if (toYmd(s) !== toYmd(e)) {
    return `${f(s)} – ${e.getMonth() + 1}/${e.getDate()} ${f(e)}`;
  }
  return `${f(s)} – ${f(e)}`;
}

export function toLocalInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function defaultRangeForDay(ymd) {
  const base = parseYmd(ymd || toYmd(new Date()));
  const now = new Date();
  // If selecting today, default start = next whole hour; else 10:00
  let startH = 10;
  let startM = 0;
  if (toYmd(base) === toYmd(now)) {
    startH = now.getHours() + 1;
    startM = 0;
    if (startH > 23) {
      startH = 23;
      startM = 0;
    }
  }
  const start = new Date(base);
  start.setHours(startH, startM, 0, 0);
  const end = new Date(start);
  end.setHours(start.getHours() + 1, start.getMinutes(), 0, 0);
  return { start, end };
}

/**
 * Inclusive day membership for display.
 * All-day: start..end (already converted to inclusive end in normalizeEvent).
 * Timed: start day .. end day, but if end is exactly midnight (00:00:00),
 * treat end day as exclusive (Google dateTime ends-at-midnight edge).
 */
export function eventOnDate(ev, ymd) {
  if (ev.allDay) {
    const s = (ev.start || '').slice(0, 10);
    const e = (ev.end || s).slice(0, 10);
    return ymd >= s && ymd <= e;
  }
  const startDate = new Date(ev.start);
  const endDate = new Date(ev.end);
  if (Number.isNaN(startDate.getTime())) return false;

  const s = toYmd(startDate);
  let e = toYmd(endDate);

  // Exact midnight end → exclusive of that calendar day
  if (
    endDate.getHours() === 0 &&
    endDate.getMinutes() === 0 &&
    endDate.getSeconds() === 0 &&
    endDate.getMilliseconds() === 0 &&
    e > s
  ) {
    const prev = new Date(endDate);
    prev.setDate(prev.getDate() - 1);
    e = toYmd(prev);
  }

  return ymd >= s && ymd <= e;
}

/** Clamp selected YMD into a given view month (keep day if possible). */
export function clampYmdToMonth(ymd, year, month) {
  if (!ymd) return toYmd(new Date(year, month, 1));
  const d = parseYmd(ymd);
  if (d.getFullYear() === year && d.getMonth() === month) return ymd;
  const day = Math.min(d.getDate(), new Date(year, month + 1, 0).getDate());
  return toYmd(new Date(year, month, day));
}

/** Sort: all-day first, then by start time, then summary. */
export function compareEvents(a, b) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  const c = String(a.start).localeCompare(String(b.start));
  if (c !== 0) return c;
  return String(a.summary || '').localeCompare(String(b.summary || ''), 'ja');
}

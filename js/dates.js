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

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfWeek(d) {
  // Sunday start (JP calendar convention matches month grid)
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
}

export function endOfWeek(d) {
  return addDays(startOfWeek(d), 6);
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

export function formatWeekLabel(anchorYmd) {
  const start = startOfWeek(parseYmd(anchorYmd));
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${start.getFullYear()}年${start.getMonth() + 1}月 ${start.getDate()}–${end.getDate()}日`;
  }
  return `${start.getMonth() + 1}/${start.getDate()} – ${end.getMonth() + 1}/${end.getDate()}`;
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

export function toLocalDateValue(date) {
  return toYmd(date instanceof Date ? date : parseYmd(date));
}

export function defaultRangeForDay(ymd) {
  const base = parseYmd(ymd || toYmd(new Date()));
  const now = new Date();
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

/** Events overlapping a local date range [startYmd, endYmd] inclusive */
export function eventInRange(ev, startYmd, endYmd) {
  if (ev.allDay) {
    const s = (ev.start || '').slice(0, 10);
    const e = (ev.end || s).slice(0, 10);
    return s <= endYmd && e >= startYmd;
  }
  const s = toYmd(new Date(ev.start));
  let e = toYmd(new Date(ev.end));
  const endDate = new Date(ev.end);
  if (
    endDate.getHours() === 0 &&
    endDate.getMinutes() === 0 &&
    endDate.getSeconds() === 0 &&
    e > s
  ) {
    const prev = new Date(endDate);
    prev.setDate(prev.getDate() - 1);
    e = toYmd(prev);
  }
  return s <= endYmd && e >= startYmd;
}

export function clampYmdToMonth(ymd, year, month) {
  if (!ymd) return toYmd(new Date(year, month, 1));
  const d = parseYmd(ymd);
  if (d.getFullYear() === year && d.getMonth() === month) return ymd;
  const day = Math.min(d.getDate(), new Date(year, month + 1, 0).getDate());
  return toYmd(new Date(year, month, day));
}

export function compareEvents(a, b) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  const c = String(a.start).localeCompare(String(b.start));
  if (c !== 0) return c;
  return String(a.summary || '').localeCompare(String(b.summary || ''), 'ja');
}

/** Snap Date to N-minute grid */
export function snapMinutes(date, step = 15) {
  const d = new Date(date);
  const m = d.getMinutes();
  const snapped = Math.round(m / step) * step;
  d.setMinutes(snapped, 0, 0);
  if (snapped === 60) {
    d.setHours(d.getHours() + 1);
    d.setMinutes(0);
  }
  return d;
}

/** Move timed event by delta ms, preserving duration */
export function shiftEventTimes(ev, deltaMs) {
  if (ev.allDay) {
    const days = Math.round(deltaMs / 86400000);
    const s = parseYmd(ev.start.slice(0, 10));
    const e = parseYmd((ev.end || ev.start).slice(0, 10));
    s.setDate(s.getDate() + days);
    e.setDate(e.getDate() + days);
    return { start: toYmd(s), end: toYmd(e), allDay: true };
  }
  const s = new Date(new Date(ev.start).getTime() + deltaMs);
  const e = new Date(new Date(ev.end).getTime() + deltaMs);
  return { start: s.toISOString(), end: e.toISOString(), allDay: false };
}

/** Move all-day / timed event to a target YMD (same local time-of-day) */
export function moveEventToDate(ev, targetYmd) {
  if (ev.allDay) {
    const s0 = parseYmd(ev.start.slice(0, 10));
    const e0 = parseYmd((ev.end || ev.start).slice(0, 10));
    const span = Math.round((e0 - s0) / 86400000);
    const s = parseYmd(targetYmd);
    const e = addDays(s, span);
    return { start: toYmd(s), end: toYmd(e), allDay: true };
  }
  const oldS = new Date(ev.start);
  const oldE = new Date(ev.end);
  const dur = oldE - oldS;
  const target = parseYmd(targetYmd);
  target.setHours(oldS.getHours(), oldS.getMinutes(), 0, 0);
  const end = new Date(target.getTime() + dur);
  return { start: target.toISOString(), end: end.toISOString(), allDay: false };
}

export function isRecurringInstance(ev) {
  return !!(ev.recurringEventId || ev.isRecurring);
}

export function minutesFromMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

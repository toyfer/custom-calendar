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
  return `${f(s)} – ${f(e)}`;
}

export function toLocalInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function defaultRangeForDay(ymd) {
  const base = parseYmd(ymd || toYmd(new Date()));
  const start = new Date(base);
  start.setHours(10, 0, 0, 0);
  const end = new Date(base);
  end.setHours(11, 0, 0, 0);
  return { start, end };
}

export function eventOnDate(ev, ymd) {
  if (ev.allDay) {
    const s = (ev.start || '').slice(0, 10);
    const e = (ev.end || s).slice(0, 10);
    return ymd >= s && ymd <= e;
  }
  const s = toYmd(new Date(ev.start));
  const e = toYmd(new Date(ev.end));
  return ymd >= s && ymd <= e;
}

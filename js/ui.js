/** DOM rendering & UI widgets — month / week / list + drag */

import { DOW, RECUR_PRESETS, VIEWS, WEEK_HOUR_END, WEEK_HOUR_START, WEEK_PX_PER_HOUR } from './constants.js';
import {
  addDays,
  compareEvents,
  eventInRange,
  eventOnDate,
  formatEventTime,
  formatMonthLabel,
  formatSelectedLabel,
  formatWeekLabel,
  minutesFromMidnight,
  parseYmd,
  startOfWeek,
  toLocalInputValue,
  toYmd,
} from './dates.js';
import {
  accountById,
  liveAccounts,
  overlayEvents,
  visibleAccounts,
  writableCalendars,
} from './state.js';

export const $ = (id) => document.getElementById(id);

export function setProp(id, prop, value) {
  const el = $(id);
  if (el) el[prop] = value;
  return el;
}

export function setDisabled(id, disabled) {
  return setProp(id, 'disabled', !!disabled);
}

export function setHidden(id, hidden) {
  const el = $(id);
  if (el) el.hidden = !!hidden;
  return el;
}

export function toast(msg, type = '') {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('error', 'ok', 'show');
  if (type) el.classList.add(type);
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3200);
}

export function setStatus(text, mode = '') {
  const pill = $('statusPill');
  if (!pill) return;
  pill.textContent = text;
  pill.classList.remove('ok', 'warn');
  if (mode) pill.classList.add(mode);
}

export function setLoading(on, text = '読み込み中…') {
  const el = $('loadingOverlay');
  if (!el) return;
  el.hidden = !on;
  setProp('loadingText', 'textContent', text);
}

export function showBanner(html) {
  const b = $('banner');
  if (!b) return;
  if (!html) {
    b.hidden = true;
    b.innerHTML = '';
    return;
  }
  b.hidden = false;
  b.innerHTML = html;
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function eventsForDate(state, ymd) {
  return overlayEvents(state)
    .filter((ev) => eventOnDate(ev, ymd))
    .sort(compareEvents);
}

// ── View mode toggle ──────────────────────────────────────
export function renderViewToggle(state) {
  const root = $('viewToggle');
  if (!root) return;
  root.querySelectorAll('[data-view]').forEach((btn) => {
    const active = btn.dataset.view === state.viewMode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

export function updateNavLabel(state) {
  if (state.viewMode === VIEWS.week) {
    setProp('monthLabel', 'textContent', formatWeekLabel(state.selectedDate || toYmd(new Date())));
  } else if (state.viewMode === VIEWS.list) {
    setProp('monthLabel', 'textContent', formatMonthLabel(state.viewYear, state.viewMonth) + ' 一覧');
  } else {
    setProp('monthLabel', 'textContent', formatMonthLabel(state.viewYear, state.viewMonth));
  }
}

// ── Accounts ──────────────────────────────────────────────
export function renderAccounts(state, handlers) {
  const bar = $('accountBar');
  const chips = $('accountChips');
  if (!bar || !chips) return;
  chips.innerHTML = '';

  const canAuth = handlers.canAuth();
  const hasLive = liveAccounts(state).length > 0;

  if (!state.accounts.length) {
    bar.hidden = true;
    setHidden('authBtn', false);
    setProp('authBtn', 'textContent', 'Google で連携');
    setDisabled('authBtn', !canAuth);
    setDisabled('refreshBtn', true);
    setDisabled('createBtn', true);
    setDisabled('addAccountBtn', !canAuth);
    renderCreateSelect(state);
    renderLegend(state);
    return;
  }

  bar.hidden = false;
  setHidden('authBtn', true);
  setDisabled('refreshBtn', !hasLive);
  setDisabled('createBtn', !hasLive);
  setDisabled('addAccountBtn', !canAuth);

  for (const a of state.accounts) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className =
      'chip' +
      (a.visible !== false ? ' visible' : ' hidden-layer') +
      (a.id === state.createAccountId ? ' create-target' : '') +
      (a.stale ? ' stale' : '');
    chip.style.setProperty('--chip-color', a.color);
    chip.setAttribute('role', 'listitem');
    chip.title = [
      a.email,
      a.visible !== false ? '表示中' : '非表示',
      a.id === state.createAccountId ? '作成先' : '',
      a.stale ? '要再連携' : '',
    ]
      .filter(Boolean)
      .join(' · ');

    if (a.picture) {
      const img = document.createElement('img');
      img.className = 'chip-avatar';
      img.src = a.picture;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      chip.appendChild(img);
    } else {
      const av = document.createElement('div');
      av.className = 'chip-avatar';
      av.textContent = (a.name || a.email || '?').slice(0, 1).toUpperCase();
      chip.appendChild(av);
    }

    const name = document.createElement('span');
    name.className = 'chip-name';
    name.textContent = a.name || a.email.split('@')[0];
    chip.appendChild(name);

    const eye = document.createElement('span');
    eye.className = 'chip-eye';
    eye.textContent = a.visible !== false ? '●' : '○';
    eye.style.color = a.visible !== false ? a.color : 'var(--text-muted)';
    chip.appendChild(eye);

    if (a.stale) {
      const warn = document.createElement('span');
      warn.textContent = '!';
      warn.style.color = 'var(--warning)';
      warn.style.fontSize = '0.75rem';
      chip.appendChild(warn);
    }

    // Click = toggle; long-press / contextmenu = menu (mobile friendly)
    let pressTimer = null;
    let longPressed = false;

    chip.addEventListener('pointerdown', (ev) => {
      if (ev.button && ev.button !== 0) return;
      longPressed = false;
      pressTimer = setTimeout(() => {
        longPressed = true;
        handlers.onAccountMenu(a, chip);
        try {
          chip.setPointerCapture?.(ev.pointerId);
        } catch {
          /* ignore */
        }
      }, 480);
    });
    const clearPress = () => {
      if (pressTimer) clearTimeout(pressTimer);
      pressTimer = null;
    };
    chip.addEventListener('pointerup', clearPress);
    chip.addEventListener('pointercancel', clearPress);
    chip.addEventListener('pointerleave', clearPress);

    chip.addEventListener('click', (ev) => {
      if (longPressed) {
        ev.preventDefault();
        return;
      }
      handlers.onToggleVisible(a.id);
    });

    chip.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      handlers.onAccountMenu(a, chip);
    });

    const menuBtn = document.createElement('span');
    menuBtn.className = 'chip-menu-btn';
    menuBtn.textContent = '▾';
    menuBtn.title = 'メニュー';
    menuBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      handlers.onAccountMenu(a, chip);
    });
    chip.appendChild(menuBtn);

    chips.appendChild(chip);
  }

  renderCreateSelect(state);
  renderLegend(state);
  updateStatusBanner(state);
}

function updateStatusBanner(state) {
  const live = liveAccounts(state).length;
  const total = state.accounts.length;
  const vis = visibleAccounts(state).length;

  if (live === 0) {
    setStatus('再連携が必要', 'warn');
    if (!state.lastFetchNote) {
      showBanner(
        'セッションのトークンが切れています。アカウントの <strong>▾</strong> から「再連携」、または「+ アカウント」で追加してください。'
      );
    }
  } else if (live < total) {
    setStatus(`${live}/${total} 有効 · 表示 ${vis}`, 'warn');
    if (!state.lastFetchNote) {
      showBanner('一部アカウントのトークンが切れています。▾ メニューから再連携できます。');
    }
  } else {
    setStatus(`${total} アカウント · 重ね表示 ${vis}`, 'ok');
    if (!state.lastFetchNote) showBanner('');
  }
}

export function renderCreateSelect(state) {
  const sel = $('createAccount');
  const calSel = $('createCalendar');
  if (!sel) return;
  sel.innerHTML = '';
  const live = liveAccounts(state);
  if (!live.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '連携アカウントがありません';
    sel.appendChild(opt);
    if (calSel) {
      calSel.innerHTML = '';
      const o = document.createElement('option');
      o.value = 'primary';
      o.textContent = '—';
      calSel.appendChild(o);
    }
    return;
  }
  for (const a of live) {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.email;
    sel.appendChild(opt);
  }
  if (state.createAccountId && live.some((a) => a.id === state.createAccountId)) {
    sel.value = state.createAccountId;
  } else {
    state.createAccountId = live[0].id;
    sel.value = live[0].id;
  }
  renderCalendarSelect(state);
}

export function renderCalendarSelect(state) {
  const calSel = $('createCalendar');
  if (!calSel) return;
  calSel.innerHTML = '';
  const accountId = state.createAccountId;
  let cals = writableCalendars(state, accountId);
  if (!cals.length) {
    cals = [{ id: 'primary', summary: 'primary', primary: true }];
  }
  for (const c of cals) {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.primary ? `${c.summary}（メイン）` : c.summary;
    calSel.appendChild(opt);
  }
  if (cals.some((c) => c.id === state.createCalendarId)) {
    calSel.value = state.createCalendarId;
  } else {
    const primary = cals.find((c) => c.primary) || cals[0];
    state.createCalendarId = primary.id;
    calSel.value = primary.id;
  }
}

export function renderLegend(state) {
  const el = $('legend');
  if (!el) return;
  const accs = visibleAccounts(state);
  if (accs.length === 0) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML = accs
    .map(
      (a) =>
        `<span class="legend-item"><span class="legend-swatch" style="background:${a.color}"></span>${escapeHtml(
          a.email
        )}${a.id === state.createAccountId ? ' <em>(作成先)</em>' : ''}</span>`
    )
    .join('');
}

export function renderRecurSelect() {
  const sel = $('eventRecur');
  if (!sel || sel.options.length) return;
  for (const p of RECUR_PRESETS) {
    const opt = document.createElement('option');
    opt.value = p.rrule;
    opt.textContent = p.label;
    sel.appendChild(opt);
  }
}

// ── Month view ────────────────────────────────────────────
export function renderMonth(state, { onSelectDate, onDropEvent }) {
  const grid = $('calendarGrid');
  if (!grid) return;
  grid.className = 'calendar-grid';
  grid.innerHTML = '';
  grid.hidden = false;
  setHidden('weekView', true);
  setHidden('listView', true);

  DOW.forEach((d, i) => {
    const el = document.createElement('div');
    el.className = 'dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '');
    el.textContent = d;
    grid.appendChild(el);
  });

  const y = state.viewYear;
  const m = state.viewMonth;
  updateNavLabel(state);

  const first = new Date(y, m, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const todayYmd = toYmd(new Date());
  const prevMonthLast = new Date(y, m, 0).getDate();

  const addDay = (date, muted) => {
    const ymd = toYmd(date);
    const dow = date.getDay();
    const el = document.createElement('div');
    el.className =
      'day' +
      (muted ? ' muted' : '') +
      (ymd === todayYmd ? ' today' : '') +
      (ymd === state.selectedDate ? ' selected' : '') +
      (dow === 0 ? ' sun' : dow === 6 ? ' sat' : '');
    el.dataset.ymd = ymd;

    // Drop target for drag-move
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drop-target');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop-target');
      const uid = e.dataTransfer.getData('text/event-uid');
      if (uid && onDropEvent) onDropEvent(uid, ymd);
    });

    const num = document.createElement('div');
    num.className = 'day-num';
    num.textContent = String(date.getDate());
    el.appendChild(num);

    const dayEvents = eventsForDate(state, ymd);
    for (const ev of dayEvents.slice(0, 3)) {
      const mini = document.createElement('div');
      mini.className = 'event-mini' + (ev.allDay ? ' all-day' : '');
      mini.style.setProperty('--ev-color', ev.color);
      mini.textContent = (ev.isRecurring ? '↻ ' : '') + ev.summary;
      mini.title = `${ev.summary}\n${formatEventTime(ev)} · ${ev.accountEmail}`;
      mini.draggable = !accountById(state, ev.accountId)?.stale;
      mini.dataset.uid = ev.uid;
      mini.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/event-uid', ev.uid);
        e.dataTransfer.effectAllowed = 'move';
        mini.classList.add('dragging');
      });
      mini.addEventListener('dragend', () => mini.classList.remove('dragging'));
      mini.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectDate(ymd, ev);
      });
      el.appendChild(mini);
    }
    if (dayEvents.length > 3) {
      const more = document.createElement('div');
      more.className = 'event-mini more';
      more.textContent = `+${dayEvents.length - 3}`;
      el.appendChild(more);
    }

    el.addEventListener('click', () => onSelectDate(ymd));
    grid.appendChild(el);
  };

  for (let i = startPad - 1; i >= 0; i--) {
    addDay(new Date(y, m - 1, prevMonthLast - i), true);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    addDay(new Date(y, m, d), false);
  }
  const total = startPad + daysInMonth;
  const trail = (7 - (total % 7)) % 7;
  for (let d = 1; d <= trail; d++) {
    addDay(new Date(y, m + 1, d), true);
  }
}

// ── Week view ─────────────────────────────────────────────
export function renderWeek(state, { onSelectDate, onEventClick, onTimeClick, onDropEvent }) {
  const root = $('weekView');
  const grid = $('calendarGrid');
  if (!root) return;
  if (grid) grid.hidden = true;
  setHidden('listView', true);
  root.hidden = false;
  root.innerHTML = '';
  updateNavLabel(state);

  const anchor = parseYmd(state.selectedDate || toYmd(new Date()));
  const weekStart = startOfWeek(anchor);
  const todayYmd = toYmd(new Date());
  const hours = WEEK_HOUR_END - WEEK_HOUR_START;
  const totalH = hours * WEEK_PX_PER_HOUR;

  // Header row: gutter + 7 days
  const head = document.createElement('div');
  head.className = 'week-head';
  const gutterH = document.createElement('div');
  gutterH.className = 'week-gutter-head';
  head.appendChild(gutterH);

  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    const ymd = toYmd(day);
    const cell = document.createElement('div');
    cell.className =
      'week-day-head' +
      (ymd === todayYmd ? ' today' : '') +
      (ymd === state.selectedDate ? ' selected' : '') +
      (day.getDay() === 0 ? ' sun' : day.getDay() === 6 ? ' sat' : '');
    cell.innerHTML = `<span class="wd">${DOW[day.getDay()]}</span><span class="dn">${day.getDate()}</span>`;
    cell.addEventListener('click', () => onSelectDate(ymd));
    head.appendChild(cell);
  }
  root.appendChild(head);

  // All-day row
  const allDayRow = document.createElement('div');
  allDayRow.className = 'week-allday';
  const allDayLabel = document.createElement('div');
  allDayLabel.className = 'week-gutter';
  allDayLabel.textContent = '終日';
  allDayRow.appendChild(allDayLabel);

  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    const ymd = toYmd(day);
    const cell = document.createElement('div');
    cell.className = 'week-allday-cell';
    cell.dataset.ymd = ymd;
    cell.addEventListener('dragover', (e) => {
      e.preventDefault();
      cell.classList.add('drop-target');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('drop-target'));
    cell.addEventListener('drop', (e) => {
      e.preventDefault();
      cell.classList.remove('drop-target');
      const uid = e.dataTransfer.getData('text/event-uid');
      if (uid && onDropEvent) onDropEvent(uid, ymd);
    });

    const dayEvs = eventsForDate(state, ymd).filter((e) => e.allDay);
    for (const ev of dayEvs) {
      const pill = document.createElement('div');
      pill.className = 'week-allday-pill';
      pill.style.setProperty('--ev-color', ev.color);
      pill.textContent = (ev.isRecurring ? '↻ ' : '') + ev.summary;
      pill.draggable = !accountById(state, ev.accountId)?.stale;
      pill.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/event-uid', ev.uid);
        e.dataTransfer.effectAllowed = 'move';
      });
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        onEventClick?.(ev);
      });
      cell.appendChild(pill);
    }
    allDayRow.appendChild(cell);
  }
  root.appendChild(allDayRow);

  // Timed body
  const body = document.createElement('div');
  body.className = 'week-body';
  body.style.setProperty('--week-h', `${totalH}px`);

  const gutter = document.createElement('div');
  gutter.className = 'week-gutter-col';
  for (let h = WEEK_HOUR_START; h < WEEK_HOUR_END; h++) {
    const lab = document.createElement('div');
    lab.className = 'week-hour-label';
    lab.style.top = `${(h - WEEK_HOUR_START) * WEEK_PX_PER_HOUR}px`;
    lab.textContent = `${String(h).padStart(2, '0')}:00`;
    gutter.appendChild(lab);
  }
  body.appendChild(gutter);

  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    const ymd = toYmd(day);
    const col = document.createElement('div');
    col.className = 'week-col' + (ymd === todayYmd ? ' today' : '');
    col.dataset.ymd = ymd;

    // hour lines
    for (let h = WEEK_HOUR_START; h < WEEK_HOUR_END; h++) {
      const line = document.createElement('div');
      line.className = 'week-hour-line';
      line.style.top = `${(h - WEEK_HOUR_START) * WEEK_PX_PER_HOUR}px`;
      col.appendChild(line);
    }

    // now indicator
    if (ymd === todayYmd) {
      const now = new Date();
      const mins = minutesFromMidnight(now) - WEEK_HOUR_START * 60;
      if (mins >= 0 && mins < hours * 60) {
        const nowLine = document.createElement('div');
        nowLine.className = 'week-now';
        nowLine.style.top = `${(mins / 60) * WEEK_PX_PER_HOUR}px`;
        col.appendChild(nowLine);
      }
    }

    col.addEventListener('click', (e) => {
      if (e.target !== col && !e.target.classList.contains('week-hour-line')) return;
      const rect = col.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const mins = Math.round(((y / WEEK_PX_PER_HOUR) * 60) / 15) * 15;
      const h = Math.floor(mins / 60) + WEEK_HOUR_START;
      const m = mins % 60;
      onTimeClick?.(ymd, h, m);
    });

    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('drop-target');
    });
    col.addEventListener('dragleave', () => col.classList.remove('drop-target'));
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drop-target');
      const uid = e.dataTransfer.getData('text/event-uid');
      if (!uid || !onDropEvent) return;
      const rect = col.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const mins = Math.round(((y / WEEK_PX_PER_HOUR) * 60) / 15) * 15;
      const h = Math.floor(mins / 60) + WEEK_HOUR_START;
      const m = mins % 60;
      onDropEvent(uid, ymd, { hour: h, minute: m });
    });

    const timed = eventsForDate(state, ymd).filter((e) => !e.allDay);
    // simple overlap columns
    const layout = layoutTimed(timed, ymd);
    for (const { ev, colIndex, colCount, topMin, durationMin } of layout) {
      const block = document.createElement('div');
      block.className = 'week-event';
      block.style.setProperty('--ev-color', ev.color);
      block.style.top = `${(topMin / 60) * WEEK_PX_PER_HOUR}px`;
      block.style.height = `${Math.max((durationMin / 60) * WEEK_PX_PER_HOUR, 18)}px`;
      block.style.left = `calc(${(colIndex / colCount) * 100}% + 2px)`;
      block.style.width = `calc(${(1 / colCount) * 100}% - 4px)`;
      block.innerHTML = `<strong>${escapeHtml(ev.summary)}</strong><span>${escapeHtml(formatEventTime(ev))}</span>`;
      block.title = `${ev.summary}\n${formatEventTime(ev)} · ${ev.accountEmail}`;
      block.draggable = !accountById(state, ev.accountId)?.stale;
      block.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/event-uid', ev.uid);
        e.dataTransfer.effectAllowed = 'move';
        block.classList.add('dragging');
      });
      block.addEventListener('dragend', () => block.classList.remove('dragging'));
      block.addEventListener('click', (e) => {
        e.stopPropagation();
        onEventClick?.(ev);
      });
      col.appendChild(block);
    }

    body.appendChild(col);
  }
  root.appendChild(body);

  // scroll to ~8am or now
  requestAnimationFrame(() => {
    const scrollTarget = Math.max(0, (8 - WEEK_HOUR_START) * WEEK_PX_PER_HOUR - 20);
    body.scrollTop = scrollTarget;
  });
}

function layoutTimed(events, ymd) {
  const items = events
    .map((ev) => {
      const s = new Date(ev.start);
      const e = new Date(ev.end);
      const dayStart = parseYmd(ymd);
      const dayEnd = addDays(dayStart, 1);
      const start = s < dayStart ? dayStart : s;
      const end = e > dayEnd ? dayEnd : e;
      let topMin = minutesFromMidnight(start) - WEEK_HOUR_START * 60;
      let durationMin = Math.max(15, (end - start) / 60000);
      if (topMin < 0) {
        durationMin += topMin;
        topMin = 0;
      }
      return { ev, topMin, durationMin, endMin: topMin + durationMin };
    })
    .filter((x) => x.durationMin > 0)
    .sort((a, b) => a.topMin - b.topMin || b.durationMin - a.durationMin);

  const colEnds = [];
  const placed = [];
  for (const item of items) {
    let colIndex = 0;
    for (; colIndex < colEnds.length; colIndex++) {
      if (colEnds[colIndex] <= item.topMin) break;
    }
    if (colIndex === colEnds.length) colEnds.push(0);
    colEnds[colIndex] = item.endMin;
    placed.push({ ...item, colIndex });
  }

  // Connected clusters → per-cluster column count
  const result = [];
  let i = 0;
  while (i < placed.length) {
    let clusterEnd = placed[i].endMin;
    let j = i + 1;
    let maxCol = placed[i].colIndex;
    while (j < placed.length && placed[j].topMin < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, placed[j].endMin);
      maxCol = Math.max(maxCol, placed[j].colIndex);
      j++;
    }
    const colCount = maxCol + 1;
    for (let k = i; k < j; k++) {
      result.push({ ...placed[k], colCount });
    }
    i = j;
  }
  return result;
}

// ── List view ─────────────────────────────────────────────
export function renderListView(state, { onSelectDate, onEventClick }) {
  const root = $('listView');
  const grid = $('calendarGrid');
  if (!root) return;
  if (grid) grid.hidden = true;
  setHidden('weekView', true);
  root.hidden = false;
  root.innerHTML = '';
  updateNavLabel(state);

  const y = state.viewYear;
  const m = state.viewMonth;
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 0);
  const startYmd = toYmd(start);
  const endYmd = toYmd(end);

  const events = overlayEvents(state)
    .filter((ev) => eventInRange(ev, startYmd, endYmd))
    .sort(compareEvents);

  if (!events.length) {
    root.innerHTML = '<div class="empty-state"><p>この月の表示中アカウントに予定はありません</p></div>';
    return;
  }

  // group by each day the event spans (within month)
  const groups = new Map();
  const bump = (key, ev) => {
    if (key < startYmd || key > endYmd) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  };
  for (const ev of events) {
    if (ev.allDay) {
      let d = parseYmd((ev.start || '').slice(0, 10));
      const last = parseYmd((ev.end || ev.start || '').slice(0, 10));
      while (d <= last) {
        bump(toYmd(d), ev);
        d = addDays(d, 1);
      }
    } else {
      let d = new Date(ev.start);
      const endD = new Date(ev.end);
      // midnight-exclusive end
      let endY = toYmd(endD);
      if (
        endD.getHours() === 0 &&
        endD.getMinutes() === 0 &&
        endD.getSeconds() === 0 &&
        endY > toYmd(d)
      ) {
        const prev = new Date(endD);
        prev.setDate(prev.getDate() - 1);
        endY = toYmd(prev);
      }
      let cur = parseYmd(toYmd(d));
      const last = parseYmd(endY);
      while (cur <= last) {
        bump(toYmd(cur), ev);
        cur = addDays(cur, 1);
      }
    }
  }
  // sort within day
  for (const [, list] of groups) list.sort(compareEvents);

  const todayYmd = toYmd(new Date());
  for (const [ymd, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const section = document.createElement('section');
    section.className = 'list-day' + (ymd === todayYmd ? ' today' : '') + (ymd === state.selectedDate ? ' selected' : '');

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'list-day-head';
    head.textContent = formatSelectedLabel(ymd);
    head.addEventListener('click', () => onSelectDate(ymd));
    section.appendChild(head);

    for (const ev of list) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'list-event';
      row.style.setProperty('--ev-color', ev.color);
      row.innerHTML = `
        <span class="list-time">${escapeHtml(formatEventTime(ev))}</span>
        <span class="list-title">${ev.isRecurring ? '↻ ' : ''}${escapeHtml(ev.summary)}</span>
        <span class="list-acct" style="--ev-color:${ev.color}">${escapeHtml(ev.accountEmail.split('@')[0])}</span>
      `;
      row.addEventListener('click', () => onEventClick?.(ev));
      section.appendChild(row);
    }
    root.appendChild(section);
  }
}

// ── Unified calendar render ───────────────────────────────
export function renderCalendar(state, handlers) {
  renderViewToggle(state);
  if (state.viewMode === VIEWS.week) {
    renderWeek(state, handlers);
  } else if (state.viewMode === VIEWS.list) {
    renderListView(state, handlers);
  } else {
    renderMonth(state, handlers);
  }
}

// ── Side event list ───────────────────────────────────────
export function renderEventList(state, handlers) {
  const list = $('eventList');
  if (!list) return;
  const ymd = state.selectedDate;

  if (!state.accounts.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📅</div>
        <p>Google アカウントを連携すると、複数アカウントの予定を重ねて表示できます</p>
        <button id="emptyAuthBtn" class="primary sm" type="button">連携する</button>
      </div>`;
    const b = $('emptyAuthBtn');
    if (b) {
      b.disabled = !handlers.canAuth();
      b.addEventListener('click', handlers.onAddAccount);
    }
    setProp('selectedDateLabel', 'textContent', '—');
    return;
  }

  if (!ymd) {
    setProp('selectedDateLabel', 'textContent', '日付を選択');
    list.innerHTML = '<div class="empty-state"><p>日付を選択してください</p></div>';
    return;
  }

  setProp('selectedDateLabel', 'textContent', formatSelectedLabel(ymd));
  const items = eventsForDate(state, ymd);

  if (!items.length) {
    list.innerHTML =
      '<div class="empty-state"><p>この日の表示中アカウントに予定はありません</p></div>';
    return;
  }

  list.innerHTML = '';
  for (const ev of items) {
    const card = document.createElement('div');
    card.className = 'event-card' + (ev.allDay ? ' all-day' : '');
    card.style.setProperty('--ev-color', ev.color);

    const row = document.createElement('div');
    row.className = 'row';

    const left = document.createElement('div');
    left.className = 'event-body';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = (ev.isRecurring ? '↻ ' : '') + ev.summary;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const calLabel =
      ev.calendarName && ev.calendarName !== 'primary' ? escapeHtml(ev.calendarName) : '';
    meta.innerHTML = `<span>${escapeHtml(formatEventTime(ev))}</span>
      <span class="acct" style="--ev-color:${ev.color}">● ${escapeHtml(ev.accountEmail)}</span>
      ${calLabel ? `<span class="cal-badge">${calLabel}</span>` : ''}
      ${ev.isRecurring ? '<span class="recur-badge">繰り返し</span>' : ''}`;

    left.appendChild(title);
    left.appendChild(meta);

    if (ev.location) {
      const loc = document.createElement('div');
      loc.className = 'loc';
      loc.textContent = '📍 ' + ev.location;
      left.appendChild(loc);
    }

    if (ev.description) {
      const desc = document.createElement('div');
      desc.className = 'desc';
      desc.textContent = ev.description;
      left.appendChild(desc);
    }

    const actions = document.createElement('div');
    actions.className = 'event-actions';

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'ghost sm';
    edit.textContent = '編集';
    edit.disabled = !!accountById(state, ev.accountId)?.stale;
    edit.addEventListener('click', () => handlers.onEdit?.(ev));
    actions.appendChild(edit);

    if (ev.htmlLink) {
      const open = document.createElement('a');
      open.className = 'ghost sm event-link';
      open.href = ev.htmlLink;
      open.target = '_blank';
      open.rel = 'noopener noreferrer';
      open.textContent = '開く';
      open.title = 'Google Calendar で開く';
      actions.appendChild(open);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'danger sm';
    del.textContent = '削除';
    del.disabled = !!accountById(state, ev.accountId)?.stale;
    del.addEventListener('click', () => handlers.onDelete(ev));
    actions.appendChild(del);

    row.appendChild(left);
    row.appendChild(actions);
    card.appendChild(row);
    list.appendChild(card);
  }
}

// ── Account menu ──────────────────────────────────────────
export function openAccountMenu(account, anchor, actions) {
  const menu = $('accountMenu');
  if (!menu || !anchor) return;
  menu.hidden = false;
  menu.innerHTML = '';

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent =
    account.email +
    (account.visible !== false ? ' · 表示中' : ' · 非表示') +
    (account.stale ? ' · 要再連携' : '');
  menu.appendChild(meta);

  const mk = (label, fn, danger = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.textContent = label;
    if (danger) b.classList.add('menu-danger');
    b.addEventListener('click', () => {
      closeAccountMenu();
      fn();
    });
    menu.appendChild(b);
  };

  mk(account.visible !== false ? 'この層を非表示' : 'この層を表示', actions.toggleVisible);
  mk('作成先にする', actions.setCreateTarget);
  if (account.stale) mk('再連携', actions.reauth);
  else mk('トークン再取得', actions.reauth);

  const sep = document.createElement('div');
  sep.className = 'sep';
  menu.appendChild(sep);
  mk('このアカウントを外す', actions.remove, true);

  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 240))}px`;

  if (openAccountMenu._onDoc) {
    document.removeEventListener('click', openAccountMenu._onDoc);
    openAccountMenu._onDoc = null;
  }

  setTimeout(() => {
    const onDoc = (e) => {
      if (!menu.contains(e.target) && !anchor.contains(e.target)) {
        closeAccountMenu();
        document.removeEventListener('click', onDoc);
        if (openAccountMenu._onDoc === onDoc) openAccountMenu._onDoc = null;
      }
    };
    openAccountMenu._onDoc = onDoc;
    document.addEventListener('click', onDoc);
  }, 0);
}

export function closeAccountMenu() {
  const menu = $('accountMenu');
  if (menu) menu.hidden = true;
  if (openAccountMenu._onDoc) {
    document.removeEventListener('click', openAccountMenu._onDoc);
    openAccountMenu._onDoc = null;
  }
}

// ── Edit modal helpers ────────────────────────────────────
export function fillEditForm(ev) {
  setProp('editTitle', 'value', ev.summary || '');
  setProp('editDesc', 'value', ev.description || '');
  setProp('editLocation', 'value', ev.location || '');
  setProp('editAllDay', 'checked', !!ev.allDay);
  const allDay = !!ev.allDay;
  setProp('editStart', 'type', allDay ? 'date' : 'datetime-local');
  setProp('editEnd', 'type', allDay ? 'date' : 'datetime-local');
  if (allDay) {
    setProp('editStart', 'value', (ev.start || '').slice(0, 10));
    setProp('editEnd', 'value', (ev.end || ev.start || '').slice(0, 10));
  } else {
    setProp('editStart', 'value', toLocalInputValue(new Date(ev.start)));
    setProp('editEnd', 'value', toLocalInputValue(new Date(ev.end)));
  }
  const scopeRow = $('editRecurScope');
  if (scopeRow) {
    scopeRow.hidden = !ev.isRecurring && !ev.recurringEventId;
  }
  setProp('editMeta', 'textContent', `${ev.accountEmail} · ${ev.calendarName || 'primary'}`);
}

export function openEditModal() {
  $('editModal')?.classList.add('open');
}

export function closeEditModal() {
  $('editModal')?.classList.remove('open');
}

export function openRecurScopeModal(kind /* 'edit' | 'delete' */) {
  const m = $('recurScopeModal');
  if (!m) return;
  setProp('recurScopeTitle', 'textContent', kind === 'delete' ? '繰り返し予定の削除' : '繰り返し予定の編集');
  setProp(
    'recurScopeLead',
    'textContent',
    kind === 'delete'
      ? 'この回だけ削除しますか？ それともシリーズ全体？'
      : 'この回だけ変更しますか？ それともシリーズ全体？'
  );
  m.dataset.kind = kind;
  m.classList.add('open');
}

export function closeRecurScopeModal() {
  $('recurScopeModal')?.classList.remove('open');
}

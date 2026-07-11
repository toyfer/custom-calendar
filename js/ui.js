/** DOM rendering & small UI widgets */

import { DOW } from './constants.js';
import {
  eventOnDate,
  formatEventTime,
  formatMonthLabel,
  formatSelectedLabel,
  toYmd,
} from './dates.js';
import {
  accountById,
  liveAccounts,
  overlayEvents,
  visibleAccounts,
} from './state.js';

export const $ = (id) => document.getElementById(id);

/** Safe property set — never throw if node missing */
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
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
}

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
    // emptyAuthBtn lives inside #eventList and is recreated by renderEventList
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

    chip.addEventListener('click', (ev) => {
      if (ev.detail === 0) return;
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
    showBanner(
      'セッションのトークンが切れています。アカウントの <strong>▾</strong> から「再連携」、または「+ アカウント」で追加してください。'
    );
  } else if (live < total) {
    setStatus(`${live}/${total} 有効 · 表示 ${vis}`, 'warn');
    showBanner('一部アカウントのトークンが切れています。▾ メニューから再連携できます。');
  } else {
    setStatus(`${total} アカウント · 重ね表示 ${vis}`, 'ok');
    showBanner('');
  }
}

export function renderCreateSelect(state) {
  const sel = $('createAccount');
  if (!sel) return;
  sel.innerHTML = '';
  const live = liveAccounts(state);
  if (!live.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '連携アカウントがありません';
    sel.appendChild(opt);
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

export function renderCalendar(state, onSelectDate) {
  const grid = $('calendarGrid');
  if (!grid) return;
  grid.innerHTML = '';

  DOW.forEach((d, i) => {
    const el = document.createElement('div');
    el.className = 'dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '');
    el.textContent = d;
    grid.appendChild(el);
  });

  const y = state.viewYear;
  const m = state.viewMonth;
  setProp('monthLabel', 'textContent', formatMonthLabel(y, m));

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

    const num = document.createElement('div');
    num.className = 'day-num';
    num.textContent = String(date.getDate());
    el.appendChild(num);

    const dayEvents = eventsForDate(state, ymd);
    for (const ev of dayEvents.slice(0, 3)) {
      const mini = document.createElement('div');
      mini.className = 'event-mini';
      mini.style.setProperty('--ev-color', ev.color);
      mini.textContent = ev.summary;
      el.appendChild(mini);
    }
    if (dayEvents.length > 3) {
      const more = document.createElement('div');
      more.className = 'event-mini';
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
    card.className = 'event-card';
    card.style.setProperty('--ev-color', ev.color);

    const row = document.createElement('div');
    row.className = 'row';

    const left = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = ev.summary;

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<span>${escapeHtml(formatEventTime(ev))}</span>
      <span class="acct" style="--ev-color:${ev.color}">● ${escapeHtml(ev.accountEmail)}</span>`;

    left.appendChild(title);
    left.appendChild(meta);
    if (ev.description) {
      const desc = document.createElement('div');
      desc.className = 'desc';
      desc.textContent = ev.description;
      left.appendChild(desc);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'danger sm';
    del.textContent = '削除';
    del.disabled = !!accountById(state, ev.accountId)?.stale;
    del.addEventListener('click', () => handlers.onDelete(ev));

    row.appendChild(left);
    row.appendChild(del);
    card.appendChild(row);
    list.appendChild(card);
  }
}

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

  const mk = (label, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.textContent = label;
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
  mk('このアカウントを外す', actions.remove);

  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.left = `${Math.min(rect.left, window.innerWidth - 240)}px`;

  setTimeout(() => {
    const onDoc = (e) => {
      if (!menu.contains(e.target) && !anchor.contains(e.target)) {
        closeAccountMenu();
        document.removeEventListener('click', onDoc);
      }
    };
    document.addEventListener('click', onDoc);
  }, 0);
}

export function closeAccountMenu() {
  const menu = $('accountMenu');
  if (menu) menu.hidden = true;
}

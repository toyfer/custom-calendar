/** main.mobile — month-first real data wiring (iPhone-safe) */
import {
  allAccountsFresh,
  cacheMonthEvents,
  loadMonthEvents,
  loadMonthMeta,
  monthKey,
} from './cache.js';
import {
  clampYmdToMonth,
  moveEventToDate,
  parseYmd as parseYmd2,
  toLocalInputValue,
  toYmd,
} from './dates.js';
import {
  buildEventResource,
  buildTimePatch,
  connectAccount,
  deleteEvent as apiDeleteEvent,
  fetchEventsForAccount,
  initGapiClient,
  initTokenClient,
  insertEvent,
  patchEvent,
  trySilentRefresh,
} from './google.js';
import {
  accountById,
  clearConfigLocal,
  createState,
  eventByUid,
  hasValidConfig,
  isPlaceholder,
  liveAccounts,
  loadConfig,
  persistAccounts,
  restoreAccounts,
  saveConfigToLocal,
} from './state.js';
import * as ui from './ui.mobile.js';

const state = createState();
state.online = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
state.fromCache = false;

let fetchSeq = 0;
let fetchInFlight = null;

function $(id) {
  return document.getElementById(id);
}

function tz() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function currentMonthKey() {
  return monthKey(state.viewYear, state.viewMonth);
}

function updateConnectivity() {
  ui.setStatusDot(state.online, !!state.fromCache);
  document.body.classList.toggle('is-offline', !state.online);
}

function paint() {
  updateConnectivity();
  ui.renderHeader(state, {
    onMonthJump: (y, m) => {
      state.viewYear = y;
      state.viewMonth = m;
      state.selectedDate = ui.ymd(y, m, 1);
      persistAccounts(state);
      paint();
      if (liveAccounts(state).length) fetchAll();
    },
    onAvatarClick: () => openAcctSheet(),
  });
  ui.renderMonthGrid(state, {
    onSelectDate: (ymd, ev) => {
      state.selectedDate = ymd;
      const d = parseYmd2(ymd);
      if (d.getFullYear() !== state.viewYear || d.getMonth() !== state.viewMonth) {
        state.viewYear = d.getFullYear();
        state.viewMonth = d.getMonth();
      }
      persistAccounts(state);
      paint();
      if (ev) openEdit(ev);
      else ui.setDrawerDetent('peek');
    },
    onDrop: (uid, ymd) => handleDrop(uid, ymd),
    onSwipeMonth: (dir) => shift(dir),
  });
  ui.renderDayDrawer(state, {
    onEdit: (e) => openEdit(e),
    onDelete: (e) => askDelete(e),
    onCreate: (ymd) => openCreate(ymd),
  });
  ui.renderAcctSheet(state, {
    onToggle: (id, visible) => {
      const a = accountById(state, id);
      if (!a) return;
      a.visible = visible;
      if (!state.accounts.some((x) => x.visible !== false)) {
        a.visible = true;
        ui.toast('少なくとも1つは表示が必要');
      }
      persistAccounts(state);
      paint();
    },
  });
}

function openAcctSheet() {
  const sheet = $('acctSheet');
  if (sheet) sheet.hidden = false;
}

function closeAcctSheet() {
  const sheet = $('acctSheet');
  if (sheet) sheet.hidden = true;
}

function openSettings() {
  const m = $('settingsModal');
  if (!m) return;
  const cid = $('cfgClientId');
  const key = $('cfgApiKey');
  if (cid) cid.value = state.clientId || '';
  if (key) key.value = state.apiKey || '';
  m.classList.add('open');
}

function closeSettings() {
  $('settingsModal')?.classList.remove('open');
}

function openCreate(ymd) {
  state.selectedDate = ymd || state.selectedDate;
  const acct = liveAccounts(state)[0];
  if (!acct) {
    ui.toast('アカウントを連携してください', 'error');
    openAcctSheet();
    return;
  }
  if (!hasValidConfig(state)) {
    ui.toast('設定で Client ID / API Key を保存してください', 'error');
    openSettings();
    return;
  }
  const title = prompt('タイトルを入力');
  if (!title) return;
  const start = new Date(parseYmd2(state.selectedDate));
  start.setHours(10, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const res = buildEventResource({
    summary: title.trim(),
    description: '',
    location: '',
    allDay: false,
    startLocal: toLocalInputValue(start),
    endLocal: toLocalInputValue(end),
    timeZone: tz(),
  });
  insertEvent(state, acct.id, res, state.createCalendarId || 'primary')
    .then(() => {
      ui.toast('作成しました', 'ok');
      return fetchAll({ force: true });
    })
    .catch((e) => ui.toast('作成失敗: ' + (e?.message || e), 'error'));
}

function shift(delta) {
  state.viewMonth += delta;
  if (state.viewMonth < 0) {
    state.viewMonth = 11;
    state.viewYear -= 1;
  } else if (state.viewMonth > 11) {
    state.viewMonth = 0;
    state.viewYear += 1;
  }
  state.selectedDate = clampYmdToMonth(state.selectedDate, state.viewYear, state.viewMonth);
  persistAccounts(state);
  paint();
  if (liveAccounts(state).length) fetchAll();
}

function setViewYearMonth(y, m) {
  state.viewYear = y;
  state.viewMonth = m;
  state.selectedDate = ui.ymd(y, m, 1);
  persistAccounts(state);
  paint();
  if (liveAccounts(state).length) fetchAll();
}

function maybeEnableAuth() {
  if (!state.gapiReady || !state.gisReady) return;
  if (!hasValidConfig(state)) {
    return;
  }
  initTokenClient(state);
  paint();
  if (liveAccounts(state).length) fetchAll();
}

window.__gapiLoaded = () => {
  gapi.load('client', async () => {
    try {
      if (hasValidConfig(state)) await initGapiClient(state);
      else state.gapiReady = true;
      maybeEnableAuth();
    } catch (err) {
      console.error(err);
      state.gapiReady = true;
      ui.toast('gapi 初期化失敗', 'error');
    }
  });
};

window.__gisLoaded = () => {
  state.gisReady = true;
  maybeEnableAuth();
};

async function addAccount() {
  if (!hasValidConfig(state)) {
    ui.toast('設定で Client ID / API Key を保存してください', 'error');
    openSettings();
    return;
  }
  if (!state.tokenClient) {
    try {
      initTokenClient(state);
    } catch (e) {
      ui.toast('認証の初期化に失敗', 'error');
      return;
    }
  }
  try {
    const account = await connectAccount(state, { mode: 'add' });
    ui.toast(`${account.email} を追加`, 'ok');
    closeAcctSheet();
    paint();
    await fetchAll({ force: true });
  } catch (err) {
    const msg = err?.error || err?.message || String(err);
    ui.toast('連携失敗: ' + msg, 'error');
  }
}

function fetchWindow() {
  const start = new Date(state.viewYear, state.viewMonth, 1, 0, 0, 0, 0);
  const end = new Date(state.viewYear, state.viewMonth + 1, 0, 23, 59, 59, 999);
  start.setDate(start.getDate() - 1);
  end.setDate(end.getDate() + 1);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

async function applyCachedMonth(mk) {
  const cached = await loadMonthEvents(mk);
  if (!cached.length) return false;
  const other = state.events.filter((e) => e.monthKey && e.monthKey !== mk);
  state.events = [...other, ...cached];
  state.fromCache = true;
  return true;
}

async function fetchAll(opts = {}) {
  const force = !!opts.force;
  const mySeq = ++fetchSeq;
  if (fetchInFlight) {
    try {
      await fetchInFlight;
    } catch {
      /* ignore */
    }
    if (mySeq !== fetchSeq) return;
  }

  const run = (async () => {
    const mk = currentMonthKey();
    const targets = liveAccounts(state);
    const hadCache = await applyCachedMonth(mk);
    if (hadCache) paint();

    if (!targets.length) {
      paint();
      return;
    }

    const metaMap = await loadMonthMeta(
      targets.map((a) => a.id),
      mk
    );
    const fresh = !force && allAccountsFresh(
      targets.map((a) => a.id),
      metaMap
    );

    if (!state.online) {
      state.fromCache = hadCache;
      paint();
      ui.toast(hadCache ? 'オフライン · キャッシュ表示' : 'オフライン · キャッシュなし', hadCache ? 'ok' : 'error');
      return;
    }

    if (fresh && hadCache) {
      state.fromCache = true;
      paint();
      return;
    }

    for (const a of state.accounts) {
      const tok = state.tokens[a.id];
      if (tok?.accessToken && tok.expiresAt && tok.expiresAt < Date.now() + 120_000) {
        await trySilentRefresh(state, a.id);
      }
    }

    const live = liveAccounts(state);
    if (!live.length) {
      paint();
      return;
    }

    try {
      const win = fetchWindow();
      const results = await Promise.allSettled(live.map((a) => fetchEventsForAccount(state, a, win)));
      if (mySeq !== fetchSeq) return;

      const merged = [];
      let fail = 0;
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const acc = live[i];
        if (r.status === 'fulfilled') {
          const payload = r.value;
          const events = Array.isArray(payload) ? payload : payload.events || [];
          merged.push(...events);
          await cacheMonthEvents(acc.id, mk, events);
        } else {
          fail += 1;
          console.error(acc.email, r.reason);
          const msg = String(r.reason?.message || r.reason || '');
          if (msg.includes('401') || r.reason?.status === 401) acc.stale = true;
        }
      }

      const other = state.events.filter((e) => e.monthKey && e.monthKey !== mk);
      const stamped = merged.map((e) => ({ ...e, monthKey: mk }));
      const liveIds = new Set(live.map((a) => a.id));
      const keptOther = other.filter((e) => !liveIds.has(e.accountId) || e.monthKey);
      state.events = [...keptOther.filter((e) => e.monthKey !== mk), ...stamped];

      if (fail) {
        const cached = await loadMonthEvents(mk);
        const failedIds = new Set();
        results.forEach((r, i) => {
          if (r.status !== 'fulfilled') failedIds.add(live[i].id);
        });
        const fromFailed = cached.filter((e) => failedIds.has(e.accountId));
        const okIds = new Set(stamped.map((e) => e.uid));
        for (const e of fromFailed) {
          if (!okIds.has(e.uid)) state.events.push(e);
        }
      }

      persistAccounts(state);
      state.fromCache = false;

      if (fail && !merged.length) ui.toast(`${fail} アカウント取得失敗`, 'error');
      else if (!merged.length) ui.toast('0 件', 'error');
      else ui.toast(`更新 ${merged.length} 件`, 'ok');

      paint();
    } catch (err) {
      console.error(err);
      ui.toast('取得失敗', 'error');
    }
  })();

  fetchInFlight = run;
  try {
    await run;
  } finally {
    if (fetchInFlight === run) fetchInFlight = null;
  }
}

function openEdit(ev) {
  state.editingEvent = ev;
  const modal = $('editModal');
  if (!modal) return;

  const t = $('editTitle');
  const s = $('editStart');
  const e = $('editEnd');
  const ad = $('editAllDay');
  const loc = $('editLocation');
  const desc = $('editDesc');
  const meta = $('editMeta');

  if (t) t.value = ev.summary || '';
  if (loc) loc.value = ev.location || '';
  if (desc) desc.value = ev.description || '';
  if (meta) {
    meta.textContent = [ev.accountEmail, ev.calendarName].filter(Boolean).join(' · ') || '';
  }
  if (ad) ad.checked = !!ev.allDay;

  try {
    if (ev.allDay) {
      if (s) {
        s.type = 'date';
        s.value = (ev.start || '').slice(0, 10) || state.selectedDate;
      }
      if (e) {
        e.type = 'date';
        e.value = (ev.end || '').slice(0, 10) || state.selectedDate;
      }
    } else {
      if (s) {
        s.type = 'datetime-local';
        s.value = toLocalInputValue(new Date(ev.start));
      }
      if (e) {
        e.type = 'datetime-local';
        e.value = toLocalInputValue(new Date(ev.end));
      }
    }
  } catch {
    /* ignore */
  }

  modal.classList.add('open');
}

function closeEdit() {
  state.editingEvent = null;
  $('editModal')?.classList.remove('open');
}

async function onEditSave(e) {
  e.preventDefault();
  const ev = state.editingEvent;
  if (!ev) return;

  const summary = ($('editTitle')?.value || '').trim();
  if (!summary) {
    ui.toast('タイトルを入力してください', 'error');
    return;
  }

  const allDay = !!$('editAllDay')?.checked;
  const startLocal = $('editStart')?.value || '';
  const endLocal = $('editEnd')?.value || '';
  const description = ($('editDesc')?.value || '').trim();
  const location = ($('editLocation')?.value || '').trim();

  const resource = buildEventResource({
    summary,
    description,
    location,
    allDay,
    startLocal,
    endLocal,
    timeZone: tz(),
    includeTimes: true,
  });

  try {
    await patchEvent(state, ev.accountId, ev.id, resource, ev.calendarId || 'primary', {
      scope: 'single',
      recurringEventId: ev.recurringEventId,
    });
    closeEdit();
    ui.toast('更新しました', 'ok');
    await fetchAll({ force: true });
  } catch (err) {
    console.error(err);
    ui.toast('更新失敗: ' + (err?.message || err), 'error');
  }
}

function askDelete(ev) {
  state.pendingDelete = { ev, scope: 'single' };
  const t = $('confirmText');
  if (t) t.textContent = `「${ev.summary || '無題'}」を削除しますか？`;
  $('confirmModal')?.classList.add('open');
}

async function confirmDelete() {
  const pending = state.pendingDelete;
  state.pendingDelete = null;
  $('confirmModal')?.classList.remove('open');
  if (!pending?.ev) return;
  const { ev, scope } = pending;
  try {
    await apiDeleteEvent(state, ev.accountId, ev.id, ev.calendarId || 'primary', {
      scope: scope || 'single',
      recurringEventId: ev.recurringEventId,
    });
    closeEdit();
    ui.toast('削除しました', 'ok');
    await fetchAll({ force: true });
  } catch (err) {
    ui.toast('削除失敗', 'error');
  }
}

async function handleDrop(uid, ymd) {
  const ev = eventByUid(state, uid);
  if (!ev) return;
  if (accountById(state, ev.accountId)?.stale) {
    ui.toast('再連携が必要', 'error');
    return;
  }
  const times = moveEventToDate(ev, ymd);
  const resource = buildTimePatch(ev, times, tz());
  try {
    await patchEvent(state, ev.accountId, ev.id, resource, ev.calendarId || 'primary', {
      scope: 'single',
    });
    ui.toast('移動しました', 'ok');
    await fetchAll({ force: true });
  } catch (err) {
    ui.toast('移動失敗', 'error');
  }
}

function buildYmPicker() {
  const g = $('ymGrid');
  if (!g) return;
  g.innerHTML = '';
  const base = state.viewYear || new Date().getFullYear();
  for (let y = base - 2; y <= base + 2; y++) {
    const h = document.createElement('div');
    h.className = 'ym-year';
    h.textContent = y + '年';
    g.appendChild(h);
    for (let m = 0; m < 12; m++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = m + 1 + '月';
      b.onclick = () => {
        $('ymPicker')?.close();
        setViewYearMonth(y, m);
      };
      g.appendChild(b);
    }
  }
}

function wireDrawerDrag() {
  const drawer = $('dayDrawer');
  if (!drawer) return;
  let startY = 0;
  let startH = 0;
  let dragging = false;

  const handle = drawer.querySelector('.drawer-handle');
  if (!handle) return;

  const onStart = (clientY) => {
    dragging = true;
    startY = clientY;
    startH = drawer.getBoundingClientRect().height;
    drawer.style.transition = 'none';
  };
  const onMove = (clientY) => {
    if (!dragging) return;
    const dy = startY - clientY;
    const maxH = window.innerHeight * 0.85;
    const minH = 100;
    const h = Math.min(maxH, Math.max(minH, startH + dy));
    drawer.style.height = h + 'px';
  };
  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    drawer.style.transition = '';
    const h = drawer.getBoundingClientRect().height;
    const vh = window.innerHeight;
    drawer.style.height = '';
    if (h < vh * 0.22) ui.setDrawerDetent('collapsed');
    else if (h < vh * 0.4) ui.setDrawerDetent('peek');
    else if (h < vh * 0.65) ui.setDrawerDetent('half');
    else ui.setDrawerDetent('full');
  };

  handle.addEventListener(
    'touchstart',
    (e) => {
      onStart(e.touches[0].clientY);
    },
    { passive: true }
  );
  window.addEventListener(
    'touchmove',
    (e) => {
      if (dragging) onMove(e.touches[0].clientY);
    },
    { passive: true }
  );
  window.addEventListener(
    'touchend',
    () => {
      onEnd();
    },
    { passive: true }
  );
}

function wire() {
  $('prevBtn')?.addEventListener('click', () => shift(-1));
  $('nextBtn')?.addEventListener('click', () => shift(1));
  $('todayBtn')?.addEventListener('click', () => {
    const n = new Date();
    state.viewYear = n.getFullYear();
    state.viewMonth = n.getMonth();
    state.selectedDate = toYmd(n);
    persistAccounts(state);
    paint();
    if (liveAccounts(state).length) fetchAll();
  });

  $('fab')?.addEventListener('click', () => openCreate(state.selectedDate));
  $('drawerAddBtn')?.addEventListener('click', () => openCreate(state.selectedDate));

  $('avatarStack')?.addEventListener('click', openAcctSheet);
  $('acctBtn')?.addEventListener('click', openAcctSheet);
  $('acctSheet')?.querySelector('[data-close-acct]')?.addEventListener('click', closeAcctSheet);
  $('addAccountBtn')?.addEventListener('click', addAccount);
  $('openSettingsBtn')?.addEventListener('click', () => {
    closeAcctSheet();
    openSettings();
  });

  $('monthLabelBtn')?.addEventListener('click', () => {
    buildYmPicker();
    $('ymPicker')?.showModal();
  });
  document.querySelector('[data-close-ym]')?.addEventListener('click', () => $('ymPicker')?.close());

  $('settingsModal')?.addEventListener('click', (ev) => {
    if (ev.target === $('settingsModal') || ev.target.hasAttribute?.('data-close-settings')) {
      closeSettings();
    }
  });

  $('settingsForm')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const CLIENT_ID = ($('cfgClientId')?.value || '').trim();
    const API_KEY = ($('cfgApiKey')?.value || '').trim();
    if (isPlaceholder(CLIENT_ID) || isPlaceholder(API_KEY) || !CLIENT_ID || !API_KEY) {
      ui.toast('有効な Client ID と API Key を入力してください', 'error');
      return;
    }
    saveConfigToLocal({ CLIENT_ID, API_KEY });
    ui.toast('設定を保存しました。再読み込みします', 'ok');
    setTimeout(() => location.reload(), 400);
  });

  $('clearCfgBtn')?.addEventListener('click', () => {
    clearConfigLocal();
    ui.toast('ローカル設定を削除しました');
    setTimeout(() => location.reload(), 400);
  });

  $('editForm')?.addEventListener('submit', onEditSave);
  $('editCancel')?.addEventListener('click', closeEdit);
  $('editModal')?.addEventListener('click', (ev) => {
    if (ev.target === $('editModal') || ev.target.hasAttribute?.('data-close-edit')) closeEdit();
  });
  $('editAllDay')?.addEventListener('change', (e) => {
    const on = e.target.checked;
    const s = $('editStart');
    const en = $('editEnd');
    if (s) s.type = on ? 'date' : 'datetime-local';
    if (en) en.type = on ? 'date' : 'datetime-local';
  });
  $('editDelete')?.addEventListener('click', () => {
    const ev = state.editingEvent;
    if (ev) askDelete(ev);
  });

  $('confirmCancel')?.addEventListener('click', () => {
    state.pendingDelete = null;
    $('confirmModal')?.classList.remove('open');
  });
  $('confirmOk')?.addEventListener('click', confirmDelete);
  $('confirmModal')?.addEventListener('click', (ev) => {
    if (ev.target === $('confirmModal')) {
      state.pendingDelete = null;
      $('confirmModal')?.classList.remove('open');
    }
  });

  wireDrawerDrag();

  window.addEventListener('online', () => {
    state.online = true;
    updateConnectivity();
    if (liveAccounts(state).length) fetchAll({ force: true });
  });
  window.addEventListener('offline', () => {
    state.online = false;
    updateConnectivity();
    paint();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAcctSheet();
      closeSettings();
      closeEdit();
      $('confirmModal')?.classList.remove('open');
      $('ymPicker')?.close();
    }
  });
}

async function boot() {
  wire();
  restoreAccounts(state);

  const now = new Date();
  if (!state.viewYear) {
    state.viewYear = now.getFullYear();
    state.viewMonth = now.getMonth();
  }
  if (!state.selectedDate) state.selectedDate = toYmd(now);
  state.selectedDate = clampYmdToMonth(state.selectedDate, state.viewYear, state.viewMonth);

  const mk = currentMonthKey();
  const cached = await loadMonthEvents(mk);
  if (cached.length) {
    state.events = cached;
    state.fromCache = true;
  }

  await loadConfig(state);
  paint();

  if (window.gapi && hasValidConfig(state)) {
    try {
      await new Promise((resolve) => {
        if (gapi.client) resolve();
        else gapi.load('client', resolve);
      });
      await initGapiClient(state);
    } catch (err) {
      console.error(err);
      state.gapiReady = true;
    }
  } else {
    state.gapiReady = true;
  }

  if (window.google?.accounts?.oauth2) state.gisReady = true;
  maybeEnableAuth();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

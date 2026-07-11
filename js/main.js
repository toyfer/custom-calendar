/**
 * Custom Calendar — entry point
 * Architecture:
 *   constants / storage / dates / state / cache / google / ui / main
 * UX: multi-account OVERLAY (not exclusive switch). Both usable for create/delete.
 */

import { cacheEvents, loadCachedEvents } from './cache.js';
import {
  defaultRangeForDay,
  parseYmd,
  toLocalInputValue,
  toYmd,
} from './dates.js';
import {
  connectAccount,
  deleteEvent as apiDeleteEvent,
  fetchEventsForAccount,
  initGapiClient,
  initTokenClient,
  insertEvent,
  revokeAndRemove,
} from './google.js';
import {
  accountById,
  createState,
  hasValidConfig,
  liveAccounts,
  loadConfig,
  persistAccounts,
  restoreAccounts,
  saveConfigToLocal,
  clearConfigLocal,
  isPlaceholder,
} from './state.js';
import {
  $,
  closeAccountMenu,
  openAccountMenu,
  renderAccounts,
  renderCalendar,
  renderEventList,
  setDisabled,
  setLoading,
  setProp,
  setStatus,
  showBanner,
  toast,
} from './ui.js';

const state = createState();

// ── render helpers ────────────────────────────────────────
function paint() {
  renderAccounts(state, {
    canAuth: () => hasValidConfig(state) && !!state.tokenClient,
    onToggleVisible: (id) => {
      const a = accountById(state, id);
      if (!a) return;
      a.visible = a.visible === false;
      if (!state.accounts.some((x) => x.visible !== false)) {
        a.visible = true;
        toast('少なくとも1つは表示が必要です');
      }
      persistAccounts(state);
      paint();
    },
    onAccountMenu: (account, anchor) => {
      openAccountMenu(account, anchor, {
        toggleVisible: () => {
          account.visible = account.visible === false;
          if (!state.accounts.some((x) => x.visible !== false)) account.visible = true;
          persistAccounts(state);
          paint();
        },
        setCreateTarget: () => {
          state.createAccountId = account.id;
          persistAccounts(state);
          paint();
          toast(`${account.email} を作成先に設定`, 'ok');
        },
        reauth: () => reauth(account.id),
        remove: () => removeAccount(account.id),
      });
    },
  });

  renderCalendar(state, (ymd) => {
    state.selectedDate = ymd;
    fillDefaultTimes(ymd);
    paint();
  });

  renderEventList(state, {
    canAuth: () => hasValidConfig(state) && !!state.tokenClient,
    onAddAccount: () => addAccount(),
    onDelete: (ev) => askDelete(ev),
  });
}

function fillDefaultTimes(ymd) {
  const allDay = $('eventAllDay');
  if (allDay?.checked) {
    setProp('eventStart', 'value', ymd);
    setProp('eventEnd', 'value', ymd);
    return;
  }
  const { start, end } = defaultRangeForDay(ymd);
  setProp('eventStart', 'value', toLocalInputValue(start));
  setProp('eventEnd', 'value', toLocalInputValue(end));
}

// ── Google bootstrapping ──────────────────────────────────
function maybeEnableAuth() {
  if (!state.gapiReady || !state.gisReady) return;
  if (!hasValidConfig(state)) {
    setDisabled('authBtn', true);
    setDisabled('emptyAuthBtn', true);
    setDisabled('addAccountBtn', true);
    setStatus('設定が必要', 'warn');
    return;
  }

  initTokenClient(state);
  setDisabled('authBtn', false);
  setDisabled('emptyAuthBtn', false);
  setDisabled('addAccountBtn', false);

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
      toast('gapi 初期化に失敗: ' + (err?.message || err), 'error');
    }
  });
};

window.__gisLoaded = () => {
  state.gisReady = true;
  maybeEnableAuth();
};

// ── account operations ────────────────────────────────────
async function addAccount() {
  if (!state.tokenClient) {
    toast('まず設定で Client ID / API Key を保存してください', 'error');
    openSettings();
    return;
  }
  try {
    setLoading(true, 'Google アカウントを選択…');
    const account = await connectAccount(state, { mode: 'add' });
    toast(`${account.email} を追加（重ね表示に合流）`, 'ok');
    showBanner('');
    paint();
    await fetchAll();
  } catch (err) {
    console.error(err);
    const msg = err?.error || err?.message || String(err);
    if (String(msg).includes('access_denied') || String(msg).includes('popup_closed')) {
      toast('認可が拒否されました。Test users にそのアカウントを追加したか確認してください', 'error');
      showBanner(
        'Testing 中は、使う <strong>すべての</strong> Google アカウントを OAuth の <strong>Test users</strong> に追加してください。'
      );
    } else {
      toast('連携失敗: ' + msg, 'error');
    }
  } finally {
    setLoading(false);
  }
}

async function reauth(accountId) {
  const acc = accountById(state, accountId);
  if (!acc) return;
  try {
    setLoading(true, `${acc.email} を再連携…`);
    // force consent so new calendarlist scope is granted
    const account = await connectAccount(state, { mode: 'reauth', hintEmail: acc.email });
    toast(`${account.email} を再連携しました（スコープ更新）`, 'ok');
    paint();
    await fetchAll();
  } catch (err) {
    console.error(err);
    toast('再連携失敗: ' + (err?.error || err?.message || err), 'error');
  } finally {
    setLoading(false);
  }
}

async function removeAccount(accountId) {
  const acc = accountById(state, accountId);
  if (!acc) return;
  if (!confirm(`${acc.email} をこのアプリから外しますか？`)) return;
  await revokeAndRemove(state, accountId);
  await cacheEvents(state.events);
  toast('アカウントを外しました');
  paint();
}

// ── data ──────────────────────────────────────────────────
async function fetchAll() {
  const targets = liveAccounts(state);
  if (!targets.length) {
    paint();
    toast('有効なアカウントがありません。再連携してください', 'error');
    return;
  }

  setLoading(true, '全カレンダーから予定を取得中…');
  try {
    const results = await Promise.allSettled(targets.map((a) => fetchEventsForAccount(state, a)));
    const merged = [];
    const metas = [];
    let fail = 0;

    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        // new shape: { events, meta }
        const payload = r.value;
        const events = Array.isArray(payload) ? payload : payload.events || [];
        const meta = Array.isArray(payload) ? null : payload.meta;
        merged.push(...events);
        if (meta) metas.push(meta);
      } else {
        fail += 1;
        console.error(targets[i].email, r.reason);
        const msg = String(r.reason?.message || r.reason || '');
        if (
          msg.includes('expired') ||
          msg.includes('Login Required') ||
          msg.includes('401') ||
          r.reason?.status === 401
        ) {
          targets[i].stale = true;
        }
      }
    });

    const liveIds = new Set(targets.map((a) => a.id));
    const kept = state.events.filter((e) => !liveIds.has(e.accountId));
    state.events = [...kept, ...merged];
    await cacheEvents(state.events);
    persistAccounts(state);
    paint();

    // Human-readable summary
    if (fail && !merged.length) {
      toast(`${fail} アカウントの取得に失敗（コンソールを確認）`, 'error');
    } else if (!merged.length) {
      const calCount = metas.reduce((s, m) => s + (m.calendars || 0), 0);
      toast(
        `0 件（カレンダー ${calCount || '?'} 個を走査）。表示月を確認 / 再連携でスコープ更新`,
        'error'
      );
      showBanner(
        `取得は成功しましたが <strong>0 件</strong> でした。` +
          `（走査カレンダー数: ${calCount || '不明'}）` +
          ` 別月に予定がある・または権限不足の可能性があります。` +
          ` チップの ▾ → <strong>再連携</strong> で新しいスコープを許可してください。`
      );
      console.info('[calendar] fetch meta', metas);
    } else {
      const calCount = metas.reduce((s, m) => s + (m.calendars || 0), 0);
      toast(`更新 ${merged.length} 件 / カレンダー ${calCount || '?'} 個`, 'ok');
      showBanner('');
      console.info('[calendar] fetch meta', metas);
    }
  } catch (err) {
    console.error(err);
    toast('取得失敗: ' + (err?.message || err), 'error');
  } finally {
    setLoading(false);
  }
}

// ── create / delete ───────────────────────────────────────
async function onCreate(e) {
  e.preventDefault();
  const accountId = $('createAccount')?.value || state.createAccountId;
  const acc = accountById(state, accountId);
  if (!acc || acc.stale) {
    toast('有効な作成先アカウントを選んでください', 'error');
    return;
  }

  const summary = ($('eventTitle')?.value || '').trim();
  const allDay = !!$('eventAllDay')?.checked;
  const startLocal = $('eventStart')?.value || '';
  const endLocal = $('eventEnd')?.value || '';
  const description = ($('eventDesc')?.value || '').trim();
  if (!summary) {
    toast('タイトルを入力してください', 'error');
    return;
  }

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let resource;

  if (allDay) {
    const s = (startLocal || state.selectedDate).slice(0, 10);
    let eDate = (endLocal || s).slice(0, 10);
    const ed = parseYmd(eDate);
    ed.setDate(ed.getDate() + 1);
    eDate = toYmd(ed);
    resource = {
      summary,
      description: description || undefined,
      start: { date: s },
      end: { date: eDate },
    };
  } else {
    if (!startLocal || !endLocal) {
      toast('開始・終了を入力してください', 'error');
      return;
    }
    const start = new Date(startLocal);
    const end = new Date(endLocal);
    if (!(end > start)) {
      toast('終了は開始より後にしてください', 'error');
      return;
    }
    resource = {
      summary,
      description: description || undefined,
      start: { dateTime: start.toISOString(), timeZone: tz },
      end: { dateTime: end.toISOString(), timeZone: tz },
    };
  }

  setDisabled('createBtn', true);
  setLoading(true, `${acc.email} に作成中…`);
  try {
    await insertEvent(state, accountId, resource, 'primary');
    state.createAccountId = accountId;
    persistAccounts(state);
    setProp('eventTitle', 'value', '');
    setProp('eventDesc', 'value', '');
    setProp('eventAllDay', 'checked', false);
    setProp('eventStart', 'type', 'datetime-local');
    setProp('eventEnd', 'type', 'datetime-local');
    fillDefaultTimes(state.selectedDate);
    toast(`作成しました → ${acc.email}`, 'ok');
    await fetchAll();
  } catch (err) {
    console.error(err);
    toast('作成失敗: ' + (err?.result?.error?.message || err?.message || err), 'error');
  } finally {
    setLoading(false);
    setDisabled('createBtn', liveAccounts(state).length === 0);
  }
}

function askDelete(ev) {
  state.pendingDelete = ev;
  setProp('confirmText', 'textContent', `「${ev.summary}」を削除しますか？（${ev.accountEmail}）`);
  $('confirmModal')?.classList.add('open');
}

async function confirmDelete() {
  const ev = state.pendingDelete;
  state.pendingDelete = null;
  $('confirmModal')?.classList.remove('open');
  if (!ev) return;

  setLoading(true, '削除中…');
  try {
    await apiDeleteEvent(state, ev.accountId, ev.id, ev.calendarId || 'primary');
    toast('削除しました', 'ok');
    await fetchAll();
  } catch (err) {
    console.error(err);
    toast('削除失敗: ' + (err?.result?.error?.message || err?.message || err), 'error');
  } finally {
    setLoading(false);
  }
}

// ── settings / wire ───────────────────────────────────────
function openSettings() {
  setProp('cfgClientId', 'value', state.clientId || '');
  setProp('cfgApiKey', 'value', state.apiKey || '');
  $('settingsModal')?.classList.add('open');
}

function closeSettings() {
  $('settingsModal')?.classList.remove('open');
}

function on(id, event, fn) {
  const el = $(id);
  if (el) el.addEventListener(event, fn);
}

function wire() {
  on('settingsBtn', 'click', openSettings);
  $('settingsModal')?.addEventListener('click', (ev) => {
    if (ev.target === $('settingsModal') || ev.target.hasAttribute?.('data-close-settings')) {
      closeSettings();
    }
  });

  on('settingsForm', 'submit', (ev) => {
    ev.preventDefault();
    const CLIENT_ID = ($('cfgClientId')?.value || '').trim();
    const API_KEY = ($('cfgApiKey')?.value || '').trim();
    if (isPlaceholder(CLIENT_ID) || isPlaceholder(API_KEY) || !CLIENT_ID || !API_KEY) {
      toast('有効な Client ID と API Key を入力してください', 'error');
      return;
    }
    saveConfigToLocal({ CLIENT_ID, API_KEY });
    toast('設定を保存しました。再読み込みします', 'ok');
    setTimeout(() => location.reload(), 500);
  });

  on('clearCfgBtn', 'click', () => {
    clearConfigLocal();
    toast('ローカル設定を削除しました');
    setTimeout(() => location.reload(), 400);
  });

  on('authBtn', 'click', addAccount);
  on('addAccountBtn', 'click', addAccount);
  on('refreshBtn', 'click', fetchAll);
  $('eventList')?.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t && (t.id === 'emptyAuthBtn' || t.closest?.('#emptyAuthBtn'))) addAccount();
  });

  on('createAccount', 'change', (e) => {
    state.createAccountId = e.target.value;
    persistAccounts(state);
    paint();
  });

  on('prevMonthBtn', 'click', async () => {
    state.viewMonth -= 1;
    if (state.viewMonth < 0) {
      state.viewMonth = 11;
      state.viewYear -= 1;
    }
    paint();
    if (liveAccounts(state).length) await fetchAll();
  });

  on('nextMonthBtn', 'click', async () => {
    state.viewMonth += 1;
    if (state.viewMonth > 11) {
      state.viewMonth = 0;
      state.viewYear += 1;
    }
    paint();
    if (liveAccounts(state).length) await fetchAll();
  });

  on('todayBtn', 'click', async () => {
    const now = new Date();
    state.viewYear = now.getFullYear();
    state.viewMonth = now.getMonth();
    state.selectedDate = toYmd(now);
    fillDefaultTimes(state.selectedDate);
    paint();
    if (liveAccounts(state).length) await fetchAll();
  });

  on('createForm', 'submit', onCreate);

  on('eventAllDay', 'change', (e) => {
    const onAllDay = e.target.checked;
    setProp('eventStart', 'type', onAllDay ? 'date' : 'datetime-local');
    setProp('eventEnd', 'type', onAllDay ? 'date' : 'datetime-local');
    fillDefaultTimes(state.selectedDate);
  });

  on('confirmCancel', 'click', () => {
    state.pendingDelete = null;
    $('confirmModal')?.classList.remove('open');
  });
  on('confirmOk', 'click', confirmDelete);
  $('confirmModal')?.addEventListener('click', (ev) => {
    if (ev.target === $('confirmModal')) {
      state.pendingDelete = null;
      $('confirmModal')?.classList.remove('open');
    }
  });

  document.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Escape') {
      closeAccountMenu();
      closeSettings();
      $('confirmModal')?.classList.remove('open');
    }
    if (e.key === 'ArrowLeft') $('prevMonthBtn')?.click();
    if (e.key === 'ArrowRight') $('nextMonthBtn')?.click();
    if (e.key === 't' || e.key === 'T') $('todayBtn')?.click();
  });
}

// ── boot ──────────────────────────────────────────────────
async function boot() {
  wire();
  restoreAccounts(state);

  const now = new Date();
  state.viewYear = now.getFullYear();
  state.viewMonth = now.getMonth();
  state.selectedDate = toYmd(now);
  fillDefaultTimes(state.selectedDate);

  const cached = await loadCachedEvents();
  if (cached.length) state.events = cached;

  await loadConfig(state);
  if (!hasValidConfig(state)) {
    setStatus('設定が必要', 'warn');
    toast('設定から Client ID / API Key を入力してください', 'error');
  }

  paint();

  // GIS is enough for token model; don't hard-depend on gapi for readiness
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
    // REST-only path
    state.gapiReady = true;
  }

  if (window.google?.accounts?.oauth2) {
    state.gisReady = true;
  }

  maybeEnableAuth();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

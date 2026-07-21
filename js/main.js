/**
 * Custom Calendar — entry point
 * Multi-account OVERLAY · PWA · cache-first API · month/week/list
 */

import { VIEWS } from './constants.js';
import {
  allAccountsFresh,
  cacheMonthEvents,
  loadMonthEvents,
  loadMonthMeta,
  monthKey,
  purgeAccountCache,
} from './cache.js';
import {
  addDays,
  clampYmdToMonth,
  defaultRangeForDay,
  moveEventToDate,
  parseYmd,
  startOfWeek,
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
  revokeAndRemove,
  trySilentRefresh,
} from './google.js';
import {
  accountById,
  createState,
  eventByUid,
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
  closeEditModal,
  closeRecurScopeModal,
  fillEditForm,
  openAccountMenu,
  openEditModal,
  openRecurScopeModal,
  renderAccounts,
  renderCalendar,
  renderCalendarSelect,
  renderEventList,
  renderRecurSelect,
  setDisabled,
  setLoading,
  setProp,
  setStatus,
  showBanner,
  toast,
} from './ui.js';

const state = createState();
state.online = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
state.fromCache = false;

let fetchSeq = 0;
let fetchInFlight = null;
let pendingRecurAction = null;

function tz() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function currentMonthKey() {
  return monthKey(state.viewYear, state.viewMonth);
}

function updateConnectivityUi() {
  const bar = $('offlineBar');
  if (bar) bar.hidden = !!state.online;
  document.body.classList.toggle('is-offline', !state.online);
  document.body.classList.toggle('from-cache', !!state.fromCache && state.online);
}

// ── render ────────────────────────────────────────────────
function paint() {
  updateConnectivityUi();

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

  renderCalendar(state, {
    onSelectDate: (ymd, ev) => {
      state.selectedDate = ymd;
      const d = parseYmd(ymd);
      if (state.viewMode === VIEWS.month) {
        if (d.getFullYear() !== state.viewYear || d.getMonth() !== state.viewMonth) {
          state.viewYear = d.getFullYear();
          state.viewMonth = d.getMonth();
          persistAccounts(state);
          paint();
          if (liveAccounts(state).length) fetchAll();
          else fillDefaultTimes(ymd);
          if (ev) openEdit(ev);
          return;
        }
      } else {
        state.viewYear = d.getFullYear();
        state.viewMonth = d.getMonth();
      }
      fillDefaultTimes(ymd);
      persistAccounts(state);
      paint();
      if (ev) openEdit(ev);
    },
    onEventClick: (ev) => openEdit(ev),
    onTimeClick: (ymd, hour, minute) => {
      state.selectedDate = ymd;
      const start = parseYmd(ymd);
      start.setHours(hour, minute, 0, 0);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      setProp('eventAllDay', 'checked', false);
      setProp('eventStart', 'type', 'datetime-local');
      setProp('eventEnd', 'type', 'datetime-local');
      setProp('eventStart', 'value', toLocalInputValue(start));
      setProp('eventEnd', 'value', toLocalInputValue(end));
      persistAccounts(state);
      paint();
      // Mobile: open composer sheet
      openComposer(true);
      $('eventTitle')?.focus();
    },
    onDropEvent: (uid, ymd, timeHint) => handleDrop(uid, ymd, timeHint),
  });

  renderEventList(state, {
    canAuth: () => hasValidConfig(state) && !!state.tokenClient,
    onAddAccount: () => addAccount(),
    onDelete: (ev) => askDelete(ev),
    onEdit: (ev) => openEdit(ev),
  });

  // Bottom nav active state
  document.querySelectorAll('[data-nav-view]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.navView === state.viewMode);
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

function openComposer(open) {
  const sheet = $('composerSheet');
  if (!sheet) return;
  sheet.classList.toggle('open', !!open);
  document.body.classList.toggle('composer-open', !!open);
}

function shiftView(delta) {
  if (state.viewMode === VIEWS.week) {
    const d = parseYmd(state.selectedDate || toYmd(new Date()));
    const next = addDays(d, delta * 7);
    state.selectedDate = toYmd(next);
    state.viewYear = next.getFullYear();
    state.viewMonth = next.getMonth();
  } else {
    state.viewMonth += delta;
    if (state.viewMonth < 0) {
      state.viewMonth = 11;
      state.viewYear -= 1;
    } else if (state.viewMonth > 11) {
      state.viewMonth = 0;
      state.viewYear += 1;
    }
    state.selectedDate = clampYmdToMonth(state.selectedDate, state.viewYear, state.viewMonth);
  }
  fillDefaultTimes(state.selectedDate);
  persistAccounts(state);
  paint();
  if (liveAccounts(state).length) return fetchAll();
  return Promise.resolve();
}

function setViewMode(mode) {
  if (!Object.values(VIEWS).includes(mode)) return;
  state.viewMode = mode;
  persistAccounts(state);
  paint();
  if (liveAccounts(state).length) fetchAll();
}

// ── Google boot ───────────────────────────────────────────
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

// ── accounts ──────────────────────────────────────────────
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
    state.lastFetchNote = '';
    showBanner('');
    paint();
    await fetchAll({ force: true });
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
    const account = await connectAccount(state, { mode: 'reauth', hintEmail: acc.email });
    toast(`${account.email} を再連携しました（スコープ更新）`, 'ok');
    state.lastFetchNote = '';
    paint();
    await fetchAll({ force: true });
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
  await purgeAccountCache(accountId);
  state.events = state.events.filter((e) => e.accountId !== accountId);
  toast('アカウントを外しました');
  paint();
}

// ── fetch (cache-first) ───────────────────────────────────
function fetchWindow() {
  if (state.viewMode === VIEWS.week && state.selectedDate) {
    const ws = startOfWeek(parseYmd(state.selectedDate));
    const we = addDays(ws, 6);
    const start = new Date(ws);
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(we);
    end.setDate(end.getDate() + 1);
    end.setHours(23, 59, 59, 999);
    const mStart = new Date(state.viewYear, state.viewMonth, 0, 0, 0, 0, 0);
    const mEnd = new Date(state.viewYear, state.viewMonth + 1, 1, 23, 59, 59, 999);
    const tMin = start < mStart ? start : mStart;
    const tMax = end > mEnd ? end : mEnd;
    return { timeMin: tMin.toISOString(), timeMax: tMax.toISOString() };
  }
  const start = new Date(state.viewYear, state.viewMonth, 1, 0, 0, 0, 0);
  const end = new Date(state.viewYear, state.viewMonth + 1, 0, 23, 59, 59, 999);
  start.setDate(start.getDate() - 1);
  end.setDate(end.getDate() + 1);
  return { timeMin: start.toISOString(), timeMax: end.toISOString() };
}

async function applyCachedMonth(mk) {
  const cached = await loadMonthEvents(mk);
  if (!cached.length) return false;
  // Keep events from other months already in memory? Prefer month slice for display
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

    // 1) Paint from cache immediately
    const hadCache = await applyCachedMonth(mk);
    if (hadCache) paint();

    if (!targets.length) {
      paint();
      if (state.accounts.length) toast('有効なアカウントがありません。再連携してください', 'error');
      return;
    }

    // 2) Skip network if all fresh (unless force / offline)
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
      if (hadCache) toast('オフライン · キャッシュを表示', 'ok');
      else toast('オフライン · キャッシュがありません', 'error');
      return;
    }

    if (fresh && hadCache) {
      state.fromCache = true;
      setStatus(`${targets.length} アカウント · キャッシュ`, 'ok');
      paint();
      return;
    }

    // 3) Soft refresh tokens then network
    for (const a of state.accounts) {
      const tok = state.tokens[a.id];
      if (tok?.accessToken && tok.expiresAt && tok.expiresAt < Date.now() + 120_000) {
        await trySilentRefresh(state, a.id);
      }
    }

    const live = liveAccounts(state);
    if (!live.length) {
      paint();
      toast('有効なアカウントがありません。再連携してください', 'error');
      return;
    }

    // Background refresh: light loading if we already showed cache
    setLoading(!hadCache, hadCache ? 'バックグラウンド更新…' : '全カレンダーから予定を取得中…');
    try {
      const win = fetchWindow();
      const results = await Promise.allSettled(live.map((a) => fetchEventsForAccount(state, a, win)));
      if (mySeq !== fetchSeq) return;

      const merged = [];
      const metas = [];
      let fail = 0;

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const acc = live[i];
        if (r.status === 'fulfilled') {
          const payload = r.value;
          const events = Array.isArray(payload) ? payload : payload.events || [];
          const meta = Array.isArray(payload) ? null : payload.meta;
          merged.push(...events);
          if (meta) metas.push(meta);
          await cacheMonthEvents(acc.id, mk, events);
        } else {
          fail += 1;
          console.error(acc.email, r.reason);
          const msg = String(r.reason?.message || r.reason || '');
          if (
            msg.includes('expired') ||
            msg.includes('Login Required') ||
            msg.includes('401') ||
            r.reason?.status === 401
          ) {
            acc.stale = true;
          }
        }
      }

      // Rebuild state.events for this month from network + keep other months
      const other = state.events.filter((e) => e.monthKey && e.monthKey !== mk);
      const stamped = merged.map((e) => ({ ...e, monthKey: mk }));
      // Also drop untagged leftovers for live accounts
      const liveIds = new Set(live.map((a) => a.id));
      const keptOther = other.filter((e) => !liveIds.has(e.accountId) || e.monthKey);
      state.events = [...keptOther.filter((e) => e.monthKey !== mk), ...stamped];
      // If some accounts failed, merge their cache back
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

      if (fail && !merged.length) {
        state.lastFetchNote = 'fail';
        toast(`${fail} アカウントの取得に失敗`, 'error');
        showBanner('予定の取得に失敗しました。再連携または ↻ を試してください。');
      } else if (!merged.length) {
        const calCount = metas.reduce((s, m) => s + (m.calendars || 0), 0);
        state.lastFetchNote = 'empty';
        toast(`0 件（カレンダー ${calCount || '?'} 個）`, 'error');
        showBanner(
          `取得は成功しましたが <strong>0 件</strong> でした。` +
            ` チップの ▾ → <strong>再連携</strong> でスコープを更新してください。`
        );
      } else {
        const calCount = metas.reduce((s, m) => s + (m.calendars || 0), 0);
        state.lastFetchNote = '';
        toast(
          hadCache
            ? `同期 ${merged.length} 件`
            : `更新 ${merged.length} 件 / カレンダー ${calCount || '?'} 個`,
          'ok'
        );
        showBanner('');
      }

      paint();
    } catch (err) {
      console.error(err);
      if (hadCache) {
        toast('更新失敗 · キャッシュを表示中', 'error');
      } else {
        toast('取得失敗: ' + (err?.message || err), 'error');
      }
    } finally {
      if (mySeq === fetchSeq) setLoading(false);
    }
  })();

  fetchInFlight = run;
  try {
    await run;
  } finally {
    if (fetchInFlight === run) fetchInFlight = null;
  }
}

// ── create ────────────────────────────────────────────────
async function onCreate(e) {
  e.preventDefault();
  const accountId = $('createAccount')?.value || state.createAccountId;
  const calendarId = $('createCalendar')?.value || state.createCalendarId || 'primary';
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
  const location = ($('eventLocation')?.value || '').trim();
  const rrule = $('eventRecur')?.value || '';

  if (!summary) {
    toast('タイトルを入力してください', 'error');
    return;
  }
  if (!allDay && (!startLocal || !endLocal)) {
    toast('開始・終了を入力してください', 'error');
    return;
  }
  if (!allDay) {
    const start = new Date(startLocal);
    const end = new Date(endLocal);
    if (!(end > start)) {
      toast('終了は開始より後にしてください', 'error');
      return;
    }
  }

  const resource = buildEventResource({
    summary,
    description,
    location,
    allDay,
    startLocal: startLocal || state.selectedDate,
    endLocal: endLocal || startLocal || state.selectedDate,
    rrule: rrule || undefined,
    timeZone: tz(),
  });

  setDisabled('createBtn', true);
  setLoading(true, `${acc.email} に作成中…`);
  try {
    await insertEvent(state, accountId, resource, calendarId);
    state.createAccountId = accountId;
    state.createCalendarId = calendarId;
    persistAccounts(state);
    setProp('eventTitle', 'value', '');
    setProp('eventDesc', 'value', '');
    setProp('eventLocation', 'value', '');
    setProp('eventAllDay', 'checked', false);
    setProp('eventRecur', 'value', '');
    setProp('eventStart', 'type', 'datetime-local');
    setProp('eventEnd', 'type', 'datetime-local');
    fillDefaultTimes(state.selectedDate);
    openComposer(false);
    toast(`作成しました → ${acc.email}`, 'ok');
    await fetchAll({ force: true });
  } catch (err) {
    console.error(err);
    toast('作成失敗: ' + (err?.data?.error?.message || err?.message || err), 'error');
  } finally {
    setLoading(false);
    setDisabled('createBtn', liveAccounts(state).length === 0);
  }
}

// ── edit / delete / drag ──────────────────────────────────
function openEdit(ev) {
  state.editingEvent = ev;
  fillEditForm(ev);
  openEditModal();
}

function askDelete(ev) {
  if (ev.isRecurring || ev.recurringEventId) {
    pendingRecurAction = { type: 'delete', ev };
    openRecurScopeModal('delete');
    return;
  }
  state.pendingDelete = { ev, scope: 'single' };
  setProp(
    'confirmText',
    'textContent',
    `「${ev.summary}」を削除しますか？（${ev.accountEmail}${ev.calendarName && ev.calendarName !== 'primary' ? ' / ' + ev.calendarName : ''}）`
  );
  $('confirmModal')?.classList.add('open');
}

async function confirmDelete() {
  const pending = state.pendingDelete;
  state.pendingDelete = null;
  $('confirmModal')?.classList.remove('open');
  if (!pending?.ev) return;
  const { ev, scope } = pending;

  setLoading(true, '削除中…');
  try {
    await apiDeleteEvent(state, ev.accountId, ev.id, ev.calendarId || 'primary', {
      scope: scope || 'single',
      recurringEventId: ev.recurringEventId,
    });
    toast(scope === 'all' ? 'シリーズを削除しました' : '削除しました', 'ok');
    await fetchAll({ force: true });
  } catch (err) {
    console.error(err);
    toast('削除失敗: ' + (err?.data?.error?.message || err?.message || err), 'error');
  } finally {
    setLoading(false);
  }
}

async function onEditSave(e) {
  e.preventDefault();
  const ev = state.editingEvent;
  if (!ev) return;

  const summary = ($('editTitle')?.value || '').trim();
  const description = ($('editDesc')?.value || '').trim();
  const location = ($('editLocation')?.value || '').trim();
  const allDay = !!$('editAllDay')?.checked;
  const startLocal = $('editStart')?.value || '';
  const endLocal = $('editEnd')?.value || '';

  if (!summary) {
    toast('タイトルを入力してください', 'error');
    return;
  }

  const apply = async (scope) => {
    const resource = buildEventResource({
      summary,
      description,
      location,
      allDay,
      startLocal,
      endLocal,
      timeZone: tz(),
      includeTimes: scope !== 'all',
    });
    setLoading(true, '保存中…');
    try {
      await patchEvent(state, ev.accountId, ev.id, resource, ev.calendarId || 'primary', {
        scope,
        recurringEventId: ev.recurringEventId,
      });
      closeEditModal();
      state.editingEvent = null;
      toast(
        scope === 'all' ? 'シリーズを更新しました（時刻は各回のまま）' : '更新しました',
        'ok'
      );
      await fetchAll({ force: true });
    } catch (err) {
      console.error(err);
      toast('更新失敗: ' + (err?.data?.error?.message || err?.message || err), 'error');
    } finally {
      setLoading(false);
    }
  };

  if (ev.isRecurring || ev.recurringEventId) {
    pendingRecurAction = { type: 'edit', ev, run: apply };
    openRecurScopeModal('edit');
    return;
  }
  await apply('single');
}

async function handleDrop(uid, ymd, timeHint) {
  const ev = eventByUid(state, uid);
  if (!ev) return;
  if (accountById(state, ev.accountId)?.stale) {
    toast('再連携が必要です', 'error');
    return;
  }

  let times;
  if (timeHint && !ev.allDay) {
    const oldS = new Date(ev.start);
    const oldE = new Date(ev.end);
    const dur = oldE - oldS;
    const start = parseYmd(ymd);
    start.setHours(timeHint.hour, timeHint.minute, 0, 0);
    const end = new Date(start.getTime() + dur);
    times = { start: start.toISOString(), end: end.toISOString(), allDay: false };
  } else if (timeHint && ev.allDay) {
    times = moveEventToDate(ev, ymd);
  } else {
    times = moveEventToDate(ev, ymd);
  }

  if (times.allDay && times.start === ev.start && times.end === ev.end) return;
  if (!times.allDay && times.start === ev.start && times.end === ev.end) return;

  const doMove = async (scope) => {
    const resource = buildTimePatch(ev, times, tz());
    setLoading(true, '移動中…');
    try {
      await patchEvent(state, ev.accountId, ev.id, resource, ev.calendarId || 'primary', {
        scope,
        recurringEventId: ev.recurringEventId,
      });
      toast('移動しました', 'ok');
      await fetchAll({ force: true });
    } catch (err) {
      console.error(err);
      toast('移動失敗: ' + (err?.data?.error?.message || err?.message || err), 'error');
    } finally {
      setLoading(false);
    }
  };

  if (ev.isRecurring || ev.recurringEventId) {
    pendingRecurAction = {
      type: 'move',
      ev,
      run: async (scope) => {
        if (scope === 'all') {
          toast('ドラッグでのシリーズ全体の移動は未対応です。編集から変更してください', 'error');
          return;
        }
        await doMove('single');
      },
    };
    openRecurScopeModal('edit');
    return;
  }
  await doMove('single');
}

function resolveRecurScope(scope) {
  closeRecurScopeModal();
  const action = pendingRecurAction;
  pendingRecurAction = null;
  if (!action) return;

  if (action.type === 'delete') {
    state.pendingDelete = { ev: action.ev, scope };
    setProp(
      'confirmText',
      'textContent',
      scope === 'all'
        ? `「${action.ev.summary}」のシリーズ全体を削除しますか？`
        : `「${action.ev.summary}」のこの回だけ削除しますか？`
    );
    $('confirmModal')?.classList.add('open');
    return;
  }

  if (action.run) action.run(scope);
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

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Only on https or localhost
  const ok =
    location.protocol === 'https:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1';
  if (!ok) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('[sw] register failed', err);
    });
  });
}

function wire() {
  renderRecurSelect();
  registerServiceWorker();

  window.addEventListener('online', () => {
    state.online = true;
    updateConnectivityUi();
    toast('オンラインに復帰', 'ok');
    if (liveAccounts(state).length) fetchAll({ force: true });
  });
  window.addEventListener('offline', () => {
    state.online = false;
    updateConnectivityUi();
    toast('オフライン · キャッシュを使用', 'error');
    paint();
  });

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
  on('refreshBtn', 'click', () => fetchAll({ force: true }));
  $('eventList')?.addEventListener('click', (ev) => {
    const t = ev.target;
    if (t && (t.id === 'emptyAuthBtn' || t.closest?.('#emptyAuthBtn'))) addAccount();
  });

  on('createAccount', 'change', (e) => {
    state.createAccountId = e.target.value;
    renderCalendarSelect(state);
    persistAccounts(state);
    paint();
  });

  on('createCalendar', 'change', (e) => {
    state.createCalendarId = e.target.value;
    persistAccounts(state);
  });

  on('prevMonthBtn', 'click', () => shiftView(-1));
  on('nextMonthBtn', 'click', () => shiftView(1));

  on('todayBtn', 'click', async () => {
    const now = new Date();
    state.viewYear = now.getFullYear();
    state.viewMonth = now.getMonth();
    state.selectedDate = toYmd(now);
    fillDefaultTimes(state.selectedDate);
    persistAccounts(state);
    paint();
    if (liveAccounts(state).length) await fetchAll();
  });

  $('viewToggle')?.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-view]');
    if (btn) setViewMode(btn.dataset.view);
  });

  // Mobile bottom nav
  document.getElementById('bottomNav')?.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-nav-view]');
    if (btn) setViewMode(btn.dataset.navView);
    if (e.target.closest?.('#fabAdd')) {
      fillDefaultTimes(state.selectedDate);
      openComposer(true);
      $('eventTitle')?.focus();
    }
  });

  on('composerClose', 'click', () => openComposer(false));
  $('composerSheet')?.addEventListener('click', (e) => {
    if (e.target === $('composerSheet')) openComposer(false);
  });

  on('createForm', 'submit', onCreate);

  on('eventAllDay', 'change', (e) => {
    const onAllDay = e.target.checked;
    setProp('eventStart', 'type', onAllDay ? 'date' : 'datetime-local');
    setProp('eventEnd', 'type', onAllDay ? 'date' : 'datetime-local');
    fillDefaultTimes(state.selectedDate);
  });

  on('editForm', 'submit', onEditSave);
  on('editCancel', 'click', () => {
    state.editingEvent = null;
    closeEditModal();
  });
  $('editModal')?.addEventListener('click', (ev) => {
    if (ev.target === $('editModal') || ev.target.hasAttribute?.('data-close-edit')) {
      state.editingEvent = null;
      closeEditModal();
    }
  });
  on('editAllDay', 'change', (e) => {
    const onAllDay = e.target.checked;
    setProp('editStart', 'type', onAllDay ? 'date' : 'datetime-local');
    setProp('editEnd', 'type', onAllDay ? 'date' : 'datetime-local');
  });
  on('editDelete', 'click', () => {
    const ev = state.editingEvent;
    closeEditModal();
    if (ev) askDelete(ev);
  });

  on('recurScopeSingle', 'click', () => resolveRecurScope('single'));
  on('recurScopeAll', 'click', () => resolveRecurScope('all'));
  on('recurScopeCancel', 'click', () => {
    pendingRecurAction = null;
    closeRecurScopeModal();
  });
  $('recurScopeModal')?.addEventListener('click', (ev) => {
    if (ev.target === $('recurScopeModal')) {
      pendingRecurAction = null;
      closeRecurScopeModal();
    }
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
      closeEditModal();
      closeRecurScopeModal();
      openComposer(false);
      $('confirmModal')?.classList.remove('open');
    }
    if (e.key === 'ArrowLeft') $('prevMonthBtn')?.click();
    if (e.key === 'ArrowRight') $('nextMonthBtn')?.click();
    if (e.key === 't' || e.key === 'T') $('todayBtn')?.click();
    if (e.key === 'm' || e.key === 'M') setViewMode(VIEWS.month);
    if (e.key === 'w' || e.key === 'W') setViewMode(VIEWS.week);
    if (e.key === 'l' || e.key === 'L') setViewMode(VIEWS.list);
  });
}

// ── boot ──────────────────────────────────────────────────
async function boot() {
  wire();
  restoreAccounts(state);

  // URL ?view=
  const params = new URLSearchParams(location.search);
  const qView = params.get('view');
  if (qView && Object.values(VIEWS).includes(qView)) state.viewMode = qView;

  const now = new Date();
  if (!state.viewYear) {
    state.viewYear = now.getFullYear();
    state.viewMonth = now.getMonth();
  }
  if (!state.selectedDate) {
    state.selectedDate = toYmd(now);
  }
  if (state.viewMode === VIEWS.month || state.viewMode === VIEWS.list) {
    state.selectedDate = clampYmdToMonth(state.selectedDate, state.viewYear, state.viewMonth);
  }
  fillDefaultTimes(state.selectedDate);

  // Month cache first paint
  const mk = currentMonthKey();
  const cached = await loadMonthEvents(mk);
  if (cached.length) {
    state.events = cached;
    state.fromCache = true;
  }

  await loadConfig(state);
  if (!hasValidConfig(state)) {
    setStatus('設定が必要', 'warn');
    toast('設定から Client ID / API Key を入力してください', 'error');
  }

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

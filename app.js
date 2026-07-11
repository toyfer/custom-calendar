/* Custom Calendar — static Google Calendar UI (no backend) */
(() => {
  'use strict';

  const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
  const SCOPES = 'https://www.googleapis.com/auth/calendar.events';
  const STORAGE_KEY = 'custom-calendar.oauth';
  const DB_NAME = 'custom-calendar-db';
  const DB_STORE = 'events';
  const DOW = ['日', '月', '火', '水', '木', '金', '土'];

  const state = {
    clientId: '',
    apiKey: '',
    tokenClient: null,
    gapiReady: false,
    gisReady: false,
    signedIn: false,
    viewYear: 0,
    viewMonth: 0, // 0-11
    selectedDate: null, // YYYY-MM-DD
    events: [], // normalized
  };

  const $ = (id) => document.getElementById(id);

  // ── UI helpers ──────────────────────────────────────────
  function toast(msg, isError = false) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function setStatus(text, ok = false) {
    const pill = $('statusPill');
    pill.textContent = text;
    pill.classList.toggle('ok', ok);
  }

  function setAuthedUI(on) {
    state.signedIn = on;
    $('authBtn').hidden = on;
    $('signoutBtn').hidden = !on;
    $('refreshBtn').disabled = !on;
    $('createBtn').disabled = !on;
    setStatus(on ? '接続中' : '未接続', on);
  }

  function openSettings() {
    $('cfgClientId').value = state.clientId || '';
    $('cfgApiKey').value = state.apiKey || '';
    $('settingsModal').classList.add('open');
  }

  function closeSettings() {
    $('settingsModal').classList.remove('open');
  }

  // ── Config ──────────────────────────────────────────────
  function loadLocalConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveLocalConfig(cfg) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }

  function clearLocalConfig() {
    localStorage.removeItem(STORAGE_KEY);
  }

  async function loadConfig() {
    const local = loadLocalConfig();
    if (local?.CLIENT_ID && local?.API_KEY && !isPlaceholder(local.CLIENT_ID)) {
      state.clientId = local.CLIENT_ID.trim();
      state.apiKey = local.API_KEY.trim();
      return 'localStorage';
    }

    try {
      const res = await fetch('./config.json', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        state.clientId = (json.CLIENT_ID || '').trim();
        state.apiKey = (json.API_KEY || '').trim();
        return 'config.json';
      }
    } catch {
      /* ignore */
    }

    return 'none';
  }

  function isPlaceholder(v) {
    return !v || v.includes('YOUR_CLIENT_ID') || v.includes('YOUR_API_KEY');
  }

  function hasValidConfig() {
    return !isPlaceholder(state.clientId) && !isPlaceholder(state.apiKey);
  }

  // ── IndexedDB cache ─────────────────────────────────────
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function cacheEvents(events) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      const store = tx.objectStore(DB_STORE);
      store.clear();
      for (const e of events) store.put(e);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  async function loadCachedEvents() {
    try {
      const db = await openDb();
      const items = await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const req = tx.objectStore(DB_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return items;
    } catch {
      return [];
    }
  }

  // ── Date utils ──────────────────────────────────────────
  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function toYmd(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function parseYmd(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function startOfMonth(y, m) {
    return new Date(y, m, 1);
  }

  function endOfMonth(y, m) {
    return new Date(y, m + 1, 0, 23, 59, 59, 999);
  }

  function formatMonthLabel(y, m) {
    return `${y}年 ${m + 1}月`;
  }

  function formatSelectedLabel(ymd) {
    const d = parseYmd(ymd);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${DOW[d.getDay()]}）`;
  }

  function formatEventTime(ev) {
    if (ev.allDay) return '終日';
    const s = new Date(ev.start);
    const e = new Date(ev.end);
    const f = (x) => `${pad(x.getHours())}:${pad(x.getMinutes())}`;
    return `${f(s)} – ${f(e)}`;
  }

  function toLocalInputValue(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function defaultFormTimes(ymd) {
    const base = parseYmd(ymd || toYmd(new Date()));
    const start = new Date(base);
    start.setHours(10, 0, 0, 0);
    const end = new Date(base);
    end.setHours(11, 0, 0, 0);
    $('eventStart').value = toLocalInputValue(start);
    $('eventEnd').value = toLocalInputValue(end);
  }

  // ── Normalize Google events ─────────────────────────────
  function normalizeEvent(item) {
    const allDay = !!item.start?.date && !item.start?.dateTime;
    const start = item.start?.dateTime || item.start?.date;
    let end = item.end?.dateTime || item.end?.date;
    // all-day end is exclusive date
    if (allDay && end) {
      const d = new Date(end + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      end = toYmd(d);
    }
    return {
      id: item.id,
      summary: item.summary || '(無題)',
      description: item.description || '',
      start,
      end,
      allDay,
      htmlLink: item.htmlLink || '',
      rawStart: item.start,
      rawEnd: item.end,
    };
  }

  function eventOnDate(ev, ymd) {
    if (ev.allDay) {
      const s = (ev.start || '').slice(0, 10);
      const e = (ev.end || s).slice(0, 10);
      return ymd >= s && ymd <= e;
    }
    const s = toYmd(new Date(ev.start));
    const e = toYmd(new Date(ev.end));
    return ymd >= s && ymd <= e;
  }

  function eventsForDate(ymd) {
    return state.events
      .filter((ev) => eventOnDate(ev, ymd))
      .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  }

  // ── Render ──────────────────────────────────────────────
  function renderCalendar() {
    const grid = $('calendarGrid');
    grid.innerHTML = '';

    for (const d of DOW) {
      const el = document.createElement('div');
      el.className = 'dow';
      el.textContent = d;
      grid.appendChild(el);
    }

    const y = state.viewYear;
    const m = state.viewMonth;
    $('monthLabel').textContent = formatMonthLabel(y, m);

    const first = startOfMonth(y, m);
    const startPad = first.getDay(); // 0 Sun
    const daysInMonth = endOfMonth(y, m).getDate();
    const todayYmd = toYmd(new Date());

    // leading days from prev month
    const prevDays = startPad;
    const prevMonthLast = new Date(y, m, 0).getDate();
    for (let i = prevDays - 1; i >= 0; i--) {
      const dayNum = prevMonthLast - i;
      const date = new Date(y, m - 1, dayNum);
      grid.appendChild(dayCell(date, true, todayYmd));
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(y, m, d);
      grid.appendChild(dayCell(date, false, todayYmd));
    }

    // trailing to fill 6 rows (42 cells) or at least complete week
    const total = prevDays + daysInMonth;
    const trail = (7 - (total % 7)) % 7;
    for (let d = 1; d <= trail; d++) {
      const date = new Date(y, m + 1, d);
      grid.appendChild(dayCell(date, true, todayYmd));
    }
  }

  function dayCell(date, muted, todayYmd) {
    const ymd = toYmd(date);
    const el = document.createElement('div');
    el.className = 'day';
    if (muted) el.classList.add('muted');
    if (ymd === todayYmd) el.classList.add('today');
    if (ymd === state.selectedDate) el.classList.add('selected');

    const num = document.createElement('div');
    num.className = 'day-num';
    num.textContent = String(date.getDate());
    el.appendChild(num);

    const dayEvents = eventsForDate(ymd).slice(0, 3);
    for (const ev of dayEvents) {
      const mini = document.createElement('div');
      mini.className = 'event-mini';
      mini.textContent = ev.summary;
      el.appendChild(mini);
    }
    if (eventsForDate(ymd).length > 3) {
      const more = document.createElement('div');
      more.className = 'event-mini';
      more.textContent = `+${eventsForDate(ymd).length - 3}`;
      el.appendChild(more);
    }

    el.addEventListener('click', () => {
      state.selectedDate = ymd;
      defaultFormTimes(ymd);
      renderCalendar();
      renderEventList();
    });

    return el;
  }

  function renderEventList() {
    const list = $('eventList');
    const ymd = state.selectedDate;
    if (!ymd) {
      $('selectedDateLabel').textContent = '日付を選択';
      list.innerHTML = '<div class="empty">日付を選択してください。</div>';
      return;
    }

    $('selectedDateLabel').textContent = formatSelectedLabel(ymd);
    const items = eventsForDate(ymd);

    if (!items.length) {
      list.innerHTML = '<div class="empty">この日の予定はありません。</div>';
      return;
    }

    list.innerHTML = '';
    for (const ev of items) {
      const card = document.createElement('div');
      card.className = 'event-card';
      card.innerHTML = `
        <div class="row">
          <div>
            <div class="title"></div>
            <div class="meta"></div>
          </div>
          <button class="danger" type="button" data-del>削除</button>
        </div>
      `;
      card.querySelector('.title').textContent = ev.summary;
      card.querySelector('.meta').textContent = formatEventTime(ev);
      card.querySelector('[data-del]').addEventListener('click', () => deleteEvent(ev.id));
      list.appendChild(card);
    }
  }

  // ── Google API ──────────────────────────────────────────
  window.__gapiLoaded = () => {
    gapi.load('client', async () => {
      try {
        if (hasValidConfig()) {
          await gapi.client.init({
            apiKey: state.apiKey,
            discoveryDocs: [DISCOVERY_DOC],
          });
        }
        state.gapiReady = true;
        maybeEnableAuth();
      } catch (err) {
        console.error(err);
        toast('gapi 初期化に失敗: ' + (err?.message || err), true);
      }
    });
  };

  window.__gisLoaded = () => {
    state.gisReady = true;
    maybeEnableAuth();
  };

  function maybeEnableAuth() {
    if (!state.gapiReady || !state.gisReady) return;

    if (!hasValidConfig()) {
      $('authBtn').disabled = true;
      setStatus('設定が必要');
      return;
    }

    state.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: state.clientId,
      scope: SCOPES,
      callback: () => {},
    });

    $('authBtn').disabled = false;

    // restore session token if gapi still has one (same page session)
    const token = gapi.client.getToken();
    if (token?.access_token) {
      setAuthedUI(true);
      fetchAndRender();
    }
  }

  async function reinitGapi() {
    await gapi.client.init({
      apiKey: state.apiKey,
      discoveryDocs: [DISCOVERY_DOC],
    });
    state.gapiReady = true;
    maybeEnableAuth();
  }

  function handleAuthClick() {
    if (!state.tokenClient) {
      toast('まず設定で Client ID / API Key を保存してください', true);
      openSettings();
      return;
    }

    state.tokenClient.callback = async (resp) => {
      if (resp.error) {
        toast('認可に失敗: ' + (resp.error || 'unknown'), true);
        return;
      }
      setAuthedUI(true);
      toast('Google と連携しました');
      await fetchAndRender();
    };

    const existing = gapi.client.getToken();
    state.tokenClient.requestAccessToken({
      prompt: existing ? '' : 'consent',
    });
  }

  function handleSignout() {
    const token = gapi.client.getToken();
    if (token) {
      google.accounts.oauth2.revoke(token.access_token, () => {});
      gapi.client.setToken('');
    }
    setAuthedUI(false);
    state.events = [];
    renderCalendar();
    renderEventList();
    toast('切断しました');
  }

  async function fetchEventsForView() {
    const timeMin = startOfMonth(state.viewYear, state.viewMonth).toISOString();
    // include a bit of next month for trailing cells
    const timeMax = new Date(state.viewYear, state.viewMonth + 1, 7, 23, 59, 59).toISOString();

    const res = await gapi.client.calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      showDeleted: false,
      singleEvents: true,
      maxResults: 2500,
      orderBy: 'startTime',
    });

    return (res.result.items || []).map(normalizeEvent);
  }

  async function fetchAndRender() {
    try {
      setStatus('取得中…', true);
      const events = await fetchEventsForView();
      state.events = events;
      await cacheEvents(events);
      renderCalendar();
      renderEventList();
      setStatus(`接続中 · ${events.length}件`, true);
    } catch (err) {
      console.error(err);
      const msg = err?.result?.error?.message || err?.message || String(err);
      // token expired?
      if (String(msg).includes('Login Required') || err?.status === 401) {
        setAuthedUI(false);
        toast('トークン期限切れ。再度連携してください', true);
      } else {
        toast('取得失敗: ' + msg, true);
        setStatus('エラー', false);
      }
    }
  }

  async function createEvent(e) {
    e.preventDefault();
    if (!state.signedIn) {
      toast('先に Google 連携してください', true);
      return;
    }

    const summary = $('eventTitle').value.trim();
    const startLocal = $('eventStart').value;
    const endLocal = $('eventEnd').value;
    const description = $('eventDesc').value.trim();

    if (!summary || !startLocal || !endLocal) {
      toast('必須項目を入力してください', true);
      return;
    }

    const start = new Date(startLocal);
    const end = new Date(endLocal);
    if (!(end > start)) {
      toast('終了は開始より後にしてください', true);
      return;
    }

    $('createBtn').disabled = true;
    try {
      await gapi.client.calendar.events.insert({
        calendarId: 'primary',
        resource: {
          summary,
          description: description || undefined,
          start: {
            dateTime: start.toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
          end: {
            dateTime: end.toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        },
      });
      $('eventTitle').value = '';
      $('eventDesc').value = '';
      toast('予定を作成しました');
      await fetchAndRender();
    } catch (err) {
      console.error(err);
      toast('作成失敗: ' + (err?.result?.error?.message || err?.message || err), true);
    } finally {
      $('createBtn').disabled = !state.signedIn;
    }
  }

  async function deleteEvent(id) {
    if (!confirm('この予定を削除しますか？')) return;
    try {
      await gapi.client.calendar.events.delete({
        calendarId: 'primary',
        eventId: id,
      });
      toast('削除しました');
      await fetchAndRender();
    } catch (err) {
      console.error(err);
      toast('削除失敗: ' + (err?.result?.error?.message || err?.message || err), true);
    }
  }

  // ── Wire UI ─────────────────────────────────────────────
  function wire() {
    $('settingsBtn').addEventListener('click', openSettings);
    $('settingsModal').addEventListener('click', (ev) => {
      if (ev.target === $('settingsModal') || ev.target.hasAttribute('data-close-settings')) {
        closeSettings();
      }
    });

    $('settingsForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const CLIENT_ID = $('cfgClientId').value.trim();
      const API_KEY = $('cfgApiKey').value.trim();
      if (isPlaceholder(CLIENT_ID) || isPlaceholder(API_KEY) || !CLIENT_ID || !API_KEY) {
        toast('有効な Client ID と API Key を入力してください', true);
        return;
      }
      saveLocalConfig({ CLIENT_ID, API_KEY });
      state.clientId = CLIENT_ID;
      state.apiKey = API_KEY;
      closeSettings();
      toast('設定を保存しました。ページを再読み込みします');
      setTimeout(() => location.reload(), 600);
    });

    $('clearCfgBtn').addEventListener('click', () => {
      clearLocalConfig();
      toast('ローカル設定を削除しました');
      setTimeout(() => location.reload(), 500);
    });

    $('authBtn').addEventListener('click', handleAuthClick);
    $('signoutBtn').addEventListener('click', handleSignout);
    $('refreshBtn').addEventListener('click', () => {
      if (state.signedIn) fetchAndRender();
      else handleAuthClick();
    });

    $('prevMonthBtn').addEventListener('click', async () => {
      state.viewMonth -= 1;
      if (state.viewMonth < 0) {
        state.viewMonth = 11;
        state.viewYear -= 1;
      }
      renderCalendar();
      if (state.signedIn) await fetchAndRender();
    });

    $('nextMonthBtn').addEventListener('click', async () => {
      state.viewMonth += 1;
      if (state.viewMonth > 11) {
        state.viewMonth = 0;
        state.viewYear += 1;
      }
      renderCalendar();
      if (state.signedIn) await fetchAndRender();
    });

    $('todayBtn').addEventListener('click', async () => {
      const now = new Date();
      state.viewYear = now.getFullYear();
      state.viewMonth = now.getMonth();
      state.selectedDate = toYmd(now);
      defaultFormTimes(state.selectedDate);
      renderCalendar();
      renderEventList();
      if (state.signedIn) await fetchAndRender();
    });

    $('createForm').addEventListener('submit', createEvent);
  }

  // ── Boot ────────────────────────────────────────────────
  async function boot() {
    wire();

    const now = new Date();
    state.viewYear = now.getFullYear();
    state.viewMonth = now.getMonth();
    state.selectedDate = toYmd(now);
    defaultFormTimes(state.selectedDate);

    // show cache immediately
    const cached = await loadCachedEvents();
    if (cached.length) {
      state.events = cached;
    }
    renderCalendar();
    renderEventList();

    const source = await loadConfig();
    if (!hasValidConfig()) {
      setStatus('設定が必要');
      toast('設定から Client ID / API Key を入力してください');
      // still allow GIS scripts to load; auth stays disabled
    } else {
      setStatus(source === 'localStorage' ? '設定済（local）' : '設定済');
    }

    // If gapi already loaded before config (race), re-init when config present
    if (window.gapi && hasValidConfig()) {
      try {
        await reinitGapi();
      } catch (err) {
        console.error(err);
      }
    }

    // If GIS already present
    if (window.google?.accounts?.oauth2) {
      state.gisReady = true;
      maybeEnableAuth();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

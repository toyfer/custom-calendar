/* Custom Calendar — multi-account Google Calendar UI */
(() => {
  'use strict';

  const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';
  const SCOPES = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ].join(' ');
  const STORAGE_CFG = 'custom-calendar.oauth';
  const STORAGE_ACCOUNTS = 'custom-calendar.accounts.v2';
  const STORAGE_TOKENS = 'custom-calendar.tokens.v2';
  const STORAGE_UI = 'custom-calendar.ui.v2';
  const DB_NAME = 'custom-calendar-db';
  const DB_STORE = 'events';
  const DOW = ['日', '月', '火', '水', '木', '金', '土'];
  const PALETTE = ['#7b93ff', '#3dd68c', '#ffb86b', '#ff6b9d', '#c4a7ff', '#5eead4', '#f0abfc', '#67e8f9'];

  const state = {
    clientId: '',
    apiKey: '',
    tokenClient: null,
    gapiReady: false,
    gisReady: false,
    accounts: [], // { id, email, name, picture, color, stale? }
    tokens: {}, // id -> { accessToken, expiresAt }
    activeAccountId: null,
    mergeAll: true,
    viewYear: 0,
    viewMonth: 0,
    selectedDate: null,
    events: [],
    pendingDelete: null,
    authMode: null, // 'add' | 'reauth' | null
    reauthTargetId: null,
  };

  const $ = (id) => document.getElementById(id);

  // ── UI helpers ──────────────────────────────────────────
  function toast(msg, type = '') {
    const el = $('toast');
    el.textContent = msg;
    el.classList.remove('error', 'ok', 'show');
    if (type) el.classList.add(type);
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function setStatus(text, mode = '') {
    const pill = $('statusPill');
    pill.textContent = text;
    pill.classList.remove('ok', 'warn');
    if (mode) pill.classList.add(mode);
  }

  function setLoading(on, text = '読み込み中…') {
    const el = $('loadingOverlay');
    el.hidden = !on;
    $('loadingText').textContent = text;
  }

  function showBanner(html) {
    const b = $('banner');
    if (!html) {
      b.hidden = true;
      b.innerHTML = '';
      return;
    }
    b.hidden = false;
    b.innerHTML = html;
  }

  function openSettings() {
    $('cfgClientId').value = state.clientId || '';
    $('cfgApiKey').value = state.apiKey || '';
    $('settingsModal').classList.add('open');
  }

  function closeSettings() {
    $('settingsModal').classList.remove('open');
  }

  // ── Persistence ─────────────────────────────────────────
  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }

  function loadSessionJson(key, fallback) {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveSessionJson(key, val) {
    sessionStorage.setItem(key, JSON.stringify(val));
  }

  function persistAccounts() {
    const meta = state.accounts.map(({ id, email, name, picture, color }) => ({
      id,
      email,
      name,
      picture,
      color,
    }));
    saveJson(STORAGE_ACCOUNTS, meta);
    saveSessionJson(STORAGE_TOKENS, state.tokens);
    saveJson(STORAGE_UI, {
      activeAccountId: state.activeAccountId,
      mergeAll: state.mergeAll,
    });
  }

  function restoreAccounts() {
    state.accounts = loadJson(STORAGE_ACCOUNTS, []);
    state.tokens = loadSessionJson(STORAGE_TOKENS, {});
    const ui = loadJson(STORAGE_UI, {});
    state.mergeAll = ui.mergeAll !== false;
    state.activeAccountId = ui.activeAccountId || state.accounts[0]?.id || null;

    // mark stale if no/expired token
    const now = Date.now();
    for (const a of state.accounts) {
      const t = state.tokens[a.id];
      a.stale = !t?.accessToken || (t.expiresAt && t.expiresAt < now + 30_000);
    }
  }

  function loadLocalConfig() {
    return loadJson(STORAGE_CFG, null);
  }

  function saveLocalConfig(cfg) {
    saveJson(STORAGE_CFG, cfg);
  }

  function clearLocalConfig() {
    localStorage.removeItem(STORAGE_CFG);
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

  // ── IndexedDB ───────────────────────────────────────────
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (db.objectStoreNames.contains(DB_STORE)) db.deleteObjectStore(DB_STORE);
        db.createObjectStore(DB_STORE, { keyPath: 'uid' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function cacheEvents(events) {
    try {
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
    } catch {
      /* ignore cache errors */
    }
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
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
      date.getHours()
    )}:${pad(date.getMinutes())}`;
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

  function nextColor() {
    const used = new Set(state.accounts.map((a) => a.color));
    return PALETTE.find((c) => !used.has(c)) || PALETTE[state.accounts.length % PALETTE.length];
  }

  // ── Events ──────────────────────────────────────────────
  function normalizeEvent(item, account) {
    const allDay = !!item.start?.date && !item.start?.dateTime;
    const start = item.start?.dateTime || item.start?.date;
    let end = item.end?.dateTime || item.end?.date;
    if (allDay && end) {
      const d = new Date(end + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      end = toYmd(d);
    }
    return {
      uid: `${account.id}:${item.id}`,
      id: item.id,
      accountId: account.id,
      accountEmail: account.email,
      accountName: account.name,
      color: account.color,
      summary: item.summary || '(無題)',
      description: item.description || '',
      start,
      end,
      allDay,
      htmlLink: item.htmlLink || '',
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

  function visibleEvents() {
    if (state.mergeAll) return state.events;
    return state.events.filter((e) => e.accountId === state.activeAccountId);
  }

  function eventsForDate(ymd) {
    return visibleEvents()
      .filter((ev) => eventOnDate(ev, ymd))
      .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  }

  function accountById(id) {
    return state.accounts.find((a) => a.id === id);
  }

  function liveAccounts() {
    return state.accounts.filter((a) => !a.stale && state.tokens[a.id]?.accessToken);
  }

  // ── Render accounts ─────────────────────────────────────
  function renderAccounts() {
    const bar = $('accountBar');
    const chips = $('accountChips');
    chips.innerHTML = '';

    if (!state.accounts.length) {
      bar.hidden = true;
      $('authBtn').hidden = false;
      $('authBtn').textContent = 'Google で連携';
      $('refreshBtn').disabled = true;
      $('createBtn').disabled = true;
      $('emptyAuthBtn').disabled = !hasValidConfig() || !state.tokenClient;
      updateCreateAccountSelect();
      renderLegend();
      return;
    }

    bar.hidden = false;
    $('authBtn').hidden = true;
    $('refreshBtn').disabled = liveAccounts().length === 0;
    $('createBtn').disabled = liveAccounts().length === 0;
    $('emptyAuthBtn').disabled = true;

    for (const a of state.accounts) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (a.id === state.activeAccountId ? ' active' : '') + (a.stale ? ' stale' : '');
      chip.style.setProperty('--chip-color', a.color);
      chip.role = 'listitem';
      chip.title = a.stale ? `${a.email}（要再連携）` : a.email;

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

      if (a.stale) {
        const warn = document.createElement('span');
        warn.textContent = '!';
        warn.style.color = 'var(--warning)';
        warn.style.fontSize = '0.75rem';
        chip.appendChild(warn);
      }

      chip.addEventListener('click', (ev) => openAccountMenu(a, ev.currentTarget));
      chips.appendChild(chip);
    }

    updateCreateAccountSelect();
    renderLegend();

    const live = liveAccounts().length;
    const total = state.accounts.length;
    if (live === 0) {
      setStatus('再連携が必要', 'warn');
      showBanner(
        'セッションのトークンが切れています。<strong>アカウント</strong>をクリックして「再連携」、または「+ アカウント」で追加してください。'
      );
    } else if (live < total) {
      setStatus(`${live}/${total} アカウント有効`, 'warn');
      showBanner('一部アカウントのトークンが切れています。チップの「!」から再連携できます。');
    } else {
      setStatus(`${total} アカウント接続中`, 'ok');
      showBanner('');
    }
  }

  function updateCreateAccountSelect() {
    const sel = $('createAccount');
    sel.innerHTML = '';
    const live = liveAccounts();
    if (!live.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'アカウントなし';
      sel.appendChild(opt);
      return;
    }
    for (const a of live) {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.email;
      sel.appendChild(opt);
    }
    if (state.activeAccountId && live.some((a) => a.id === state.activeAccountId)) {
      sel.value = state.activeAccountId;
    }
  }

  function renderLegend() {
    const el = $('legend');
    const accs = state.mergeAll ? state.accounts : state.accounts.filter((a) => a.id === state.activeAccountId);
    if (accs.length <= 1) {
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
          )}</span>`
      )
      .join('');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  let menuCloser = null;
  function openAccountMenu(account, anchor) {
    const menu = $('accountMenu');
    menu.hidden = false;
    menu.innerHTML = '';

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = account.email + (account.stale ? ' · 要再連携' : '');
    menu.appendChild(meta);

    const mk = (label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.role = 'menuitem';
      b.textContent = label;
      b.addEventListener('click', () => {
        closeAccountMenu();
        fn();
      });
      menu.appendChild(b);
    };

    mk('このアカウントを表示', () => {
      state.activeAccountId = account.id;
      state.mergeAll = false;
      $('mergeToggle').checked = false;
      persistAccounts();
      renderAccounts();
      renderCalendar();
      renderEventList();
    });

    if (account.stale) {
      mk('再連携', () => reauthAccount(account.id));
    } else {
      mk('アクティブ（作成先）にする', () => {
        state.activeAccountId = account.id;
        persistAccounts();
        renderAccounts();
        toast(`${account.email} を作成先に設定`, 'ok');
      });
    }

    const sep = document.createElement('div');
    sep.className = 'sep';
    menu.appendChild(sep);

    mk('このアカウントを外す', () => removeAccount(account.id));

    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.left = `${Math.min(rect.left, window.innerWidth - 240)}px`;

    clearTimeout(menuCloser);
    setTimeout(() => {
      const onDoc = (e) => {
        if (!menu.contains(e.target) && e.target !== anchor) {
          closeAccountMenu();
          document.removeEventListener('click', onDoc);
        }
      };
      document.addEventListener('click', onDoc);
    }, 0);
  }

  function closeAccountMenu() {
    $('accountMenu').hidden = true;
  }

  // ── Render calendar / list ──────────────────────────────
  function renderCalendar() {
    const grid = $('calendarGrid');
    grid.innerHTML = '';

    DOW.forEach((d, i) => {
      const el = document.createElement('div');
      el.className = 'dow' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '');
      el.textContent = d;
      grid.appendChild(el);
    });

    const y = state.viewYear;
    const m = state.viewMonth;
    $('monthLabel').textContent = formatMonthLabel(y, m);

    const first = startOfMonth(y, m);
    const startPad = first.getDay();
    const daysInMonth = endOfMonth(y, m).getDate();
    const todayYmd = toYmd(new Date());

    const prevMonthLast = new Date(y, m, 0).getDate();
    for (let i = startPad - 1; i >= 0; i--) {
      grid.appendChild(dayCell(new Date(y, m - 1, prevMonthLast - i), true, todayYmd));
    }
    for (let d = 1; d <= daysInMonth; d++) {
      grid.appendChild(dayCell(new Date(y, m, d), false, todayYmd));
    }
    const total = startPad + daysInMonth;
    const trail = (7 - (total % 7)) % 7;
    for (let d = 1; d <= trail; d++) {
      grid.appendChild(dayCell(new Date(y, m + 1, d), true, todayYmd));
    }
  }

  function dayCell(date, muted, todayYmd) {
    const ymd = toYmd(date);
    const el = document.createElement('div');
    const dow = date.getDay();
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

    const dayEvents = eventsForDate(ymd);
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

    if (!state.accounts.length) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📅</div>
          <p>Google アカウントを連携すると予定が表示されます</p>
          <button id="emptyAuthBtn2" class="primary sm" type="button">連携する</button>
        </div>`;
      const b = document.getElementById('emptyAuthBtn2');
      if (b) {
        b.disabled = !hasValidConfig() || !state.tokenClient;
        b.addEventListener('click', () => addAccount());
      }
      $('selectedDateLabel').textContent = '—';
      return;
    }

    if (!ymd) {
      $('selectedDateLabel').textContent = '日付を選択';
      list.innerHTML = '<div class="empty-state"><p>日付を選択してください</p></div>';
      return;
    }

    $('selectedDateLabel').textContent = formatSelectedLabel(ymd);
    const items = eventsForDate(ymd);

    if (!items.length) {
      list.innerHTML = '<div class="empty-state"><p>この日の予定はありません</p></div>';
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
      del.disabled = !!accountById(ev.accountId)?.stale;
      del.addEventListener('click', () => askDelete(ev));

      row.appendChild(left);
      row.appendChild(del);
      card.appendChild(row);
      list.appendChild(card);
    }
  }

  // ── Google auth multi-account ───────────────────────────
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
        toast('gapi 初期化に失敗: ' + (err?.message || err), 'error');
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
      $('emptyAuthBtn').disabled = true;
      setStatus('設定が必要', 'warn');
      return;
    }

    state.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: state.clientId,
      scope: SCOPES,
      callback: () => {},
    });

    $('authBtn').disabled = false;
    $('emptyAuthBtn').disabled = false;
    $('addAccountBtn').disabled = false;

    // hydrate from restored tokens
    if (liveAccounts().length) {
      renderAccounts();
      fetchAndRender();
    } else if (state.accounts.length) {
      renderAccounts();
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

  function applyToken(accessToken) {
    gapi.client.setToken({ access_token: accessToken });
  }

  async function fetchUserInfo(accessToken) {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error('userinfo failed: ' + res.status);
    return res.json();
  }

  function requestToken({ prompt, hint, loginHint }) {
    return new Promise((resolve, reject) => {
      if (!state.tokenClient) {
        reject(new Error('token client not ready'));
        return;
      }
      state.tokenClient.callback = (resp) => {
        if (resp.error) {
          reject(resp);
          return;
        }
        resolve(resp);
      };
      const opts = {};
      if (prompt) opts.prompt = prompt;
      // login_hint helps re-auth same account
      if (hint || loginHint) opts.hint = hint || loginHint;
      state.tokenClient.requestAccessToken(opts);
    });
  }

  async function addAccount() {
    if (!state.tokenClient) {
      toast('まず設定で Client ID / API Key を保存してください', 'error');
      openSettings();
      return;
    }

    try {
      setLoading(true, 'Google アカウントを選択…');
      // select_account always shows picker → multi-account
      const resp = await requestToken({ prompt: 'select_account consent' });
      const accessToken = resp.access_token;
      const expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;

      const info = await fetchUserInfo(accessToken);
      const id = info.sub;
      if (!id) throw new Error('no user id');

      const existing = accountById(id);
      if (existing) {
        state.tokens[id] = { accessToken, expiresAt };
        existing.stale = false;
        existing.name = info.name || existing.name;
        existing.picture = info.picture || existing.picture;
        existing.email = info.email || existing.email;
        state.activeAccountId = id;
        toast(`${existing.email} を更新しました`, 'ok');
      } else {
        const account = {
          id,
          email: info.email || 'unknown',
          name: info.name || info.email || 'User',
          picture: info.picture || '',
          color: nextColor(),
          stale: false,
        };
        state.accounts.push(account);
        state.tokens[id] = { accessToken, expiresAt };
        state.activeAccountId = id;
        toast(`${account.email} を追加しました`, 'ok');
      }

      // reminder: test users
      showBanner('');
      persistAccounts();
      renderAccounts();
      await fetchAndRender();
    } catch (err) {
      console.error(err);
      const msg = err?.error || err?.message || String(err);
      if (String(msg).includes('access_denied') || String(msg).includes('popup_closed')) {
        toast(
          '認可が拒否されました。Test users にその Google アカウントを追加したか確認してください',
          'error'
        );
        showBanner(
          '403 / 拒否: OAuth 同意画面が <strong>Testing</strong> のときは、使う Google アカウントをすべて <strong>Test users</strong> に追加してください。'
        );
      } else {
        toast('連携失敗: ' + msg, 'error');
      }
    } finally {
      setLoading(false);
    }
  }

  async function reauthAccount(accountId) {
    const acc = accountById(accountId);
    if (!acc) return;
    try {
      setLoading(true, `${acc.email} を再連携…`);
      const resp = await requestToken({
        prompt: 'consent',
        hint: acc.email,
      });
      const accessToken = resp.access_token;
      const expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;

      // verify identity
      const info = await fetchUserInfo(accessToken);
      if (info.sub && info.sub !== accountId) {
        // user picked a different account — treat as add/update that one
        const id = info.sub;
        let target = accountById(id);
        if (!target) {
          target = {
            id,
            email: info.email || 'unknown',
            name: info.name || info.email || 'User',
            picture: info.picture || '',
            color: nextColor(),
            stale: false,
          };
          state.accounts.push(target);
        } else {
          target.stale = false;
          target.name = info.name || target.name;
          target.picture = info.picture || target.picture;
          target.email = info.email || target.email;
        }
        state.tokens[id] = { accessToken, expiresAt };
        state.activeAccountId = id;
        toast(`${target.email} を連携しました`, 'ok');
      } else {
        state.tokens[accountId] = { accessToken, expiresAt };
        acc.stale = false;
        if (info.name) acc.name = info.name;
        if (info.picture) acc.picture = info.picture;
        toast(`${acc.email} を再連携しました`, 'ok');
      }

      persistAccounts();
      renderAccounts();
      await fetchAndRender();
    } catch (err) {
      console.error(err);
      toast('再連携失敗: ' + (err?.error || err?.message || err), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function removeAccount(accountId) {
    const acc = accountById(accountId);
    if (!acc) return;
    if (!confirm(`${acc.email} をこのアプリから外しますか？`)) return;

    const tok = state.tokens[accountId];
    if (tok?.accessToken) {
      try {
        google.accounts.oauth2.revoke(tok.accessToken, () => {});
      } catch {
        /* ignore */
      }
    }
    state.accounts = state.accounts.filter((a) => a.id !== accountId);
    delete state.tokens[accountId];
    state.events = state.events.filter((e) => e.accountId !== accountId);
    if (state.activeAccountId === accountId) {
      state.activeAccountId = state.accounts[0]?.id || null;
    }
    persistAccounts();
    await cacheEvents(state.events);
    renderAccounts();
    renderCalendar();
    renderEventList();
    toast('アカウントを外しました');
  }

  async function withAccountToken(accountId, fn) {
    const tok = state.tokens[accountId];
    if (!tok?.accessToken) throw new Error('token missing');
    if (tok.expiresAt && tok.expiresAt < Date.now() + 15_000) {
      const acc = accountById(accountId);
      if (acc) acc.stale = true;
      persistAccounts();
      throw new Error('token expired');
    }
    applyToken(tok.accessToken);
    return fn();
  }

  async function fetchEventsForAccount(account) {
    return withAccountToken(account.id, async () => {
      const timeMin = startOfMonth(state.viewYear, state.viewMonth).toISOString();
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
      return (res.result.items || []).map((item) => normalizeEvent(item, account));
    });
  }

  async function fetchAndRender() {
    const targets = liveAccounts();
    if (!targets.length) {
      renderCalendar();
      renderEventList();
      return;
    }

    setLoading(true, '予定を取得中…');
    try {
      const results = await Promise.allSettled(targets.map((a) => fetchEventsForAccount(a)));
      const merged = [];
      let fail = 0;
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          merged.push(...r.value);
        } else {
          fail += 1;
          console.error(targets[i].email, r.reason);
          const acc = targets[i];
          const msg = String(r.reason?.message || r.reason || '');
          if (msg.includes('expired') || msg.includes('Login Required') || msg.includes('401')) {
            acc.stale = true;
          }
        }
      });

      // keep events from non-fetched accounts if any (stale)
      const liveIds = new Set(targets.map((a) => a.id));
      const kept = state.events.filter((e) => !liveIds.has(e.accountId));
      state.events = [...kept, ...merged];
      await cacheEvents(state.events);
      persistAccounts();
      renderAccounts();
      renderCalendar();
      renderEventList();

      if (fail) toast(`${fail} アカウントの取得に失敗（要再連携の可能性）`, 'error');
      else toast(`更新しました（${merged.length} 件）`, 'ok');
    } catch (err) {
      console.error(err);
      toast('取得失敗: ' + (err?.message || err), 'error');
    } finally {
      setLoading(false);
    }
  }

  async function createEvent(e) {
    e.preventDefault();
    const accountId = $('createAccount').value || state.activeAccountId;
    const acc = accountById(accountId);
    if (!acc || acc.stale) {
      toast('有効なアカウントを選んでください', 'error');
      return;
    }

    const summary = $('eventTitle').value.trim();
    const allDay = $('eventAllDay').checked;
    const startLocal = $('eventStart').value;
    const endLocal = $('eventEnd').value;
    const description = $('eventDesc').value.trim();

    if (!summary) {
      toast('タイトルを入力してください', 'error');
      return;
    }

    let resource;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (allDay) {
      const s = (startLocal || state.selectedDate).slice(0, 10);
      let eDate = (endLocal || s).slice(0, 10);
      // exclusive end
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

    $('createBtn').disabled = true;
    setLoading(true, '作成中…');
    try {
      await withAccountToken(accountId, async () => {
        await gapi.client.calendar.events.insert({
          calendarId: 'primary',
          resource,
        });
      });
      $('eventTitle').value = '';
      $('eventDesc').value = '';
      $('eventAllDay').checked = false;
      toast('予定を作成しました', 'ok');
      await fetchAndRender();
    } catch (err) {
      console.error(err);
      toast('作成失敗: ' + (err?.result?.error?.message || err?.message || err), 'error');
    } finally {
      setLoading(false);
      $('createBtn').disabled = liveAccounts().length === 0;
    }
  }

  function askDelete(ev) {
    state.pendingDelete = ev;
    $('confirmText').textContent = `「${ev.summary}」を削除しますか？（${ev.accountEmail}）`;
    $('confirmModal').classList.add('open');
  }

  async function confirmDelete() {
    const ev = state.pendingDelete;
    state.pendingDelete = null;
    $('confirmModal').classList.remove('open');
    if (!ev) return;

    setLoading(true, '削除中…');
    try {
      await withAccountToken(ev.accountId, async () => {
        await gapi.client.calendar.events.delete({
          calendarId: 'primary',
          eventId: ev.id,
        });
      });
      toast('削除しました', 'ok');
      await fetchAndRender();
    } catch (err) {
      console.error(err);
      toast('削除失敗: ' + (err?.result?.error?.message || err?.message || err), 'error');
    } finally {
      setLoading(false);
    }
  }

  // ── Wire ────────────────────────────────────────────────
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
        toast('有効な Client ID と API Key を入力してください', 'error');
        return;
      }
      saveLocalConfig({ CLIENT_ID, API_KEY });
      toast('設定を保存しました。再読み込みします', 'ok');
      setTimeout(() => location.reload(), 500);
    });

    $('clearCfgBtn').addEventListener('click', () => {
      clearLocalConfig();
      toast('ローカル設定を削除しました');
      setTimeout(() => location.reload(), 400);
    });

    $('authBtn').addEventListener('click', addAccount);
    $('emptyAuthBtn').addEventListener('click', addAccount);
    $('addAccountBtn').addEventListener('click', addAccount);
    $('refreshBtn').addEventListener('click', () => fetchAndRender());

    $('mergeToggle').addEventListener('change', (e) => {
      state.mergeAll = e.target.checked;
      persistAccounts();
      renderLegend();
      renderCalendar();
      renderEventList();
    });

    $('createAccount').addEventListener('change', (e) => {
      state.activeAccountId = e.target.value;
      persistAccounts();
      renderAccounts();
    });

    $('prevMonthBtn').addEventListener('click', async () => {
      state.viewMonth -= 1;
      if (state.viewMonth < 0) {
        state.viewMonth = 11;
        state.viewYear -= 1;
      }
      renderCalendar();
      if (liveAccounts().length) await fetchAndRender();
    });

    $('nextMonthBtn').addEventListener('click', async () => {
      state.viewMonth += 1;
      if (state.viewMonth > 11) {
        state.viewMonth = 0;
        state.viewYear += 1;
      }
      renderCalendar();
      if (liveAccounts().length) await fetchAndRender();
    });

    $('todayBtn').addEventListener('click', async () => {
      const now = new Date();
      state.viewYear = now.getFullYear();
      state.viewMonth = now.getMonth();
      state.selectedDate = toYmd(now);
      defaultFormTimes(state.selectedDate);
      renderCalendar();
      renderEventList();
      if (liveAccounts().length) await fetchAndRender();
    });

    $('createForm').addEventListener('submit', createEvent);

    $('eventAllDay').addEventListener('change', (e) => {
      const on = e.target.checked;
      $('eventStart').type = on ? 'date' : 'datetime-local';
      $('eventEnd').type = on ? 'date' : 'datetime-local';
      if (on) {
        const ymd = state.selectedDate || toYmd(new Date());
        $('eventStart').value = ymd;
        $('eventEnd').value = ymd;
      } else {
        defaultFormTimes(state.selectedDate);
      }
    });

    $('confirmCancel').addEventListener('click', () => {
      state.pendingDelete = null;
      $('confirmModal').classList.remove('open');
    });
    $('confirmOk').addEventListener('click', confirmDelete);
    $('confirmModal').addEventListener('click', (ev) => {
      if (ev.target === $('confirmModal')) {
        state.pendingDelete = null;
        $('confirmModal').classList.remove('open');
      }
    });

    // keyboard: arrows change month when not in input
    document.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') $('prevMonthBtn').click();
      if (e.key === 'ArrowRight') $('nextMonthBtn').click();
      if (e.key === 't' || e.key === 'T') $('todayBtn').click();
    });
  }

  async function boot() {
    wire();
    restoreAccounts();
    $('mergeToggle').checked = state.mergeAll;

    const now = new Date();
    state.viewYear = now.getFullYear();
    state.viewMonth = now.getMonth();
    state.selectedDate = toYmd(now);
    defaultFormTimes(state.selectedDate);

    const cached = await loadCachedEvents();
    if (cached.length) state.events = cached;

    renderAccounts();
    renderCalendar();
    renderEventList();

    const source = await loadConfig();
    if (!hasValidConfig()) {
      setStatus('設定が必要', 'warn');
      toast('設定から Client ID / API Key を入力してください', 'error');
    } else {
      setStatus(state.accounts.length ? '準備中…' : '設定済');
    }

    if (window.gapi && hasValidConfig()) {
      try {
        await reinitGapi();
      } catch (err) {
        console.error(err);
      }
    }

    if (window.google?.accounts?.oauth2) {
      state.gisReady = true;
      maybeEnableAuth();
    }

    // silent note about multi test users
    if (state.accounts.length === 0 && hasValidConfig()) {
      /* idle */
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

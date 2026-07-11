/** Application state + persistence (overlay-first multi-account) */

import { PALETTE, STORAGE, VIEWS } from './constants.js';
import { local, session } from './storage.js';

export function createState() {
  return {
    clientId: '',
    apiKey: '',
    tokenClient: null,
    gapiReady: false,
    gisReady: false,

    accounts: [],
    tokens: {},
    createAccountId: null,
    createCalendarId: 'primary', // calendar id for create form

    /** Writable calendars per account: accountId -> [{id, summary, primary, accessRole}] */
    calendarsByAccount: {},

    viewMode: VIEWS.month, // month | week | list
    viewYear: 0,
    viewMonth: 0,
    selectedDate: null,
    events: [],

    pendingDelete: null,
    /** Edit modal target */
    editingEvent: null,
    /** Recurring edit scope: 'single' | 'all' | null */
    recurringScope: null,

    lastFetchNote: '',
  };
}

export function isPlaceholder(v) {
  return !v || v.includes('YOUR_CLIENT_ID') || v.includes('YOUR_API_KEY');
}

export function hasValidConfig(state) {
  return !isPlaceholder(state.clientId) && !isPlaceholder(state.apiKey);
}

export function nextColor(accounts) {
  const used = new Set(accounts.map((a) => a.color));
  return PALETTE.find((c) => !used.has(c)) || PALETTE[accounts.length % PALETTE.length];
}

export function accountById(state, id) {
  return state.accounts.find((a) => a.id === id) || null;
}

export function liveAccounts(state) {
  return state.accounts.filter((a) => !a.stale && state.tokens[a.id]?.accessToken);
}

export function visibleAccounts(state) {
  return state.accounts.filter((a) => a.visible !== false);
}

export function visibleLiveAccounts(state) {
  return liveAccounts(state).filter((a) => a.visible !== false);
}

export function markStaleFlags(state) {
  const now = Date.now();
  for (const a of state.accounts) {
    const t = state.tokens[a.id];
    a.stale = !t?.accessToken || (t.expiresAt && t.expiresAt < now + 30_000);
  }
}

export function writableCalendars(state, accountId) {
  const list = state.calendarsByAccount[accountId] || [];
  return list.filter((c) => c.writable);
}

export function persistAccounts(state) {
  const meta = state.accounts.map(({ id, email, name, picture, color, visible }) => ({
    id,
    email,
    name,
    picture,
    color,
    visible: visible !== false,
  }));
  local.set(STORAGE.accounts, meta);
  session.set(STORAGE.tokens, state.tokens);
  local.set(STORAGE.ui, {
    createAccountId: state.createAccountId,
    createCalendarId: state.createCalendarId,
    viewMode: state.viewMode,
    viewYear: state.viewYear,
    viewMonth: state.viewMonth,
    selectedDate: state.selectedDate,
  });
}

export function restoreAccounts(state) {
  let accounts = local.get(STORAGE.accounts, null);
  if (!accounts) {
    const legacy = local.get('custom-calendar.accounts.v2', []);
    accounts = legacy.map((a) => ({ ...a, visible: true }));
  }

  state.accounts = (accounts || []).map((a) => ({
    ...a,
    visible: a.visible !== false,
    stale: true,
  }));

  let tokens = session.get(STORAGE.tokens, null);
  if (!tokens) tokens = session.get('custom-calendar.tokens.v2', {});
  state.tokens = tokens || {};

  const ui = local.get(STORAGE.ui, {}) || {};
  const legacyUi = local.get('custom-calendar.ui.v3', {}) || local.get('custom-calendar.ui.v2', {}) || {};
  const merged = { ...legacyUi, ...ui };

  state.createAccountId =
    merged.createAccountId || merged.activeAccountId || state.accounts[0]?.id || null;
  state.createCalendarId = merged.createCalendarId || 'primary';
  state.viewMode = Object.values(VIEWS).includes(merged.viewMode) ? merged.viewMode : VIEWS.month;

  if (typeof merged.viewYear === 'number' && typeof merged.viewMonth === 'number') {
    state.viewYear = merged.viewYear;
    state.viewMonth = merged.viewMonth;
  }
  if (merged.selectedDate) state.selectedDate = merged.selectedDate;

  markStaleFlags(state);
}

export function loadConfigFromLocal() {
  return local.get(STORAGE.config, null);
}

export function saveConfigToLocal(cfg) {
  local.set(STORAGE.config, cfg);
}

export function clearConfigLocal() {
  local.remove(STORAGE.config);
}

export async function loadConfig(state) {
  const fromLocal = loadConfigFromLocal();
  if (fromLocal?.CLIENT_ID && fromLocal?.API_KEY && !isPlaceholder(fromLocal.CLIENT_ID)) {
    state.clientId = fromLocal.CLIENT_ID.trim();
    state.apiKey = fromLocal.API_KEY.trim();
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

export function overlayEvents(state) {
  const visibleIds = new Set(visibleAccounts(state).map((a) => a.id));
  return state.events.filter((e) => visibleIds.has(e.accountId));
}

export function eventByUid(state, uid) {
  return state.events.find((e) => e.uid === uid) || null;
}

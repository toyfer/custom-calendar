/** Google Identity + Calendar API access (REST; multi-calendar) */

import { DISCOVERY_DOC, SCOPES } from './constants.js';
import {
  accountById,
  hasValidConfig,
  liveAccounts,
  nextColor,
  persistAccounts,
} from './state.js';
import { toYmd } from './dates.js';

const CAL_BASE = 'https://www.googleapis.com/calendar/v3';

export function normalizeEvent(item, account, calendarMeta = {}) {
  const allDay = !!item.start?.date && !item.start?.dateTime;
  const start = item.start?.dateTime || item.start?.date;
  let end = item.end?.dateTime || item.end?.date;
  if (allDay && end) {
    // all-day end is exclusive
    const d = new Date(`${end}T00:00:00`);
    d.setDate(d.getDate() - 1);
    end = toYmd(d);
  }
  return {
    uid: `${account.id}:${calendarMeta.id || 'primary'}:${item.id}`,
    id: item.id,
    accountId: account.id,
    accountEmail: account.email,
    accountName: account.name,
    calendarId: calendarMeta.id || 'primary',
    calendarName: calendarMeta.summary || 'primary',
    color: account.color,
    summary: item.summary || '(無題)',
    description: item.description || '',
    start,
    end,
    allDay,
    htmlLink: item.htmlLink || '',
  };
}

export async function initGapiClient(state) {
  // Calendar uses REST; gapi is only needed if present for legacy hooks.
  if (typeof gapi === 'undefined' || !gapi.client) {
    state.gapiReady = true;
    return;
  }
  try {
    await gapi.client.init({
      apiKey: state.apiKey,
      discoveryDocs: [DISCOVERY_DOC],
    });
  } catch (err) {
    console.warn('[calendar] gapi.client.init failed (REST only)', err);
  }
  state.gapiReady = true;
}

export function initTokenClient(state, callback = () => {}) {
  state.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: state.clientId,
    scope: SCOPES,
    callback,
  });
}

export async function fetchUserInfo(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`userinfo failed: ${res.status}`);
  return res.json();
}

export function requestAccessToken(state, { prompt, hint } = {}) {
  return new Promise((resolve, reject) => {
    if (!state.tokenClient) {
      reject(new Error('token client not ready'));
      return;
    }
    state.tokenClient.callback = (resp) => {
      if (resp.error) reject(resp);
      else resolve(resp);
    };
    const opts = {};
    if (prompt) opts.prompt = prompt;
    if (hint) opts.hint = hint;
    state.tokenClient.requestAccessToken(opts);
  });
}

export async function connectAccount(state, { mode = 'add', hintEmail = '' } = {}) {
  if (!hasValidConfig(state) || !state.tokenClient) {
    throw new Error('OAuth not configured');
  }

  const prompt = mode === 'add' ? 'select_account consent' : 'consent';
  const resp = await requestAccessToken(state, {
    prompt,
    hint: hintEmail || undefined,
  });

  const accessToken = resp.access_token;
  const expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
  const info = await fetchUserInfo(accessToken);
  const id = info.sub;
  if (!id) throw new Error('no user id');

  // Log granted scopes for debugging empty calendar results
  if (resp.scope) {
    console.info('[calendar] granted scopes:', resp.scope);
  }

  let account = accountById(state, id);
  if (account) {
    account.stale = false;
    account.name = info.name || account.name;
    account.picture = info.picture || account.picture;
    account.email = info.email || account.email;
    if (account.visible === undefined) account.visible = true;
  } else {
    account = {
      id,
      email: info.email || 'unknown',
      name: info.name || info.email || 'User',
      picture: info.picture || '',
      color: nextColor(state.accounts),
      visible: true,
      stale: false,
    };
    state.accounts.push(account);
  }

  state.tokens[id] = { accessToken, expiresAt, scope: resp.scope || '' };

  if (!state.createAccountId || !accountById(state, state.createAccountId)) {
    state.createAccountId = id;
  }

  persistAccounts(state);
  return account;
}

export async function revokeAndRemove(state, accountId) {
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
  if (state.createAccountId === accountId) {
    state.createAccountId = liveAccounts(state)[0]?.id || state.accounts[0]?.id || null;
  }
  persistAccounts(state);
}

function getValidToken(state, accountId) {
  const tok = state.tokens[accountId];
  if (!tok?.accessToken) throw new Error('token missing');
  if (tok.expiresAt && tok.expiresAt < Date.now() + 15_000) {
    const acc = accountById(state, accountId);
    if (acc) acc.stale = true;
    persistAccounts(state);
    throw new Error('token expired');
  }
  return tok.accessToken;
}

async function calendarRequest(accessToken, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${CAL_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    const msg = data?.error?.message || res.statusText || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Inclusive local month window → RFC3339 (UTC via toISOString) */
export function monthWindow(viewYear, viewMonth) {
  // from first day 00:00 local to last day 23:59:59.999 local
  const start = new Date(viewYear, viewMonth, 1, 0, 0, 0, 0);
  const end = new Date(viewYear, viewMonth + 1, 0, 23, 59, 59, 999);
  // pad ±1 day so timezone edge events are not dropped
  start.setDate(start.getDate() - 1);
  end.setDate(end.getDate() + 1);
  return {
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
  };
}

async function listCalendars(accessToken) {
  // calendar.events scope can list calendars the user has event access to
  // Prefer calendarList; fall back to primary only
  try {
    const data = await calendarRequest(
      accessToken,
      '/users/me/calendarList?maxResults=250&showHidden=true'
    );
    const items = data?.items || [];
    if (items.length) {
      return items
        .filter((c) => c.accessRole && c.accessRole !== 'none')
        .map((c) => ({
          id: c.id,
          summary: c.summary || c.id,
          primary: !!c.primary,
          backgroundColor: c.backgroundColor,
        }));
    }
  } catch (err) {
    console.warn('[calendar] calendarList failed, using primary only', err);
  }
  return [{ id: 'primary', summary: 'primary', primary: true }];
}

async function listEventsForCalendar(accessToken, calendarId, timeMin, timeMax) {
  const all = [];
  let pageToken = '';
  const encId = encodeURIComponent(calendarId);

  do {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      showDeleted: 'false',
      singleEvents: 'true',
      maxResults: '2500',
      orderBy: 'startTime',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const data = await calendarRequest(
      accessToken,
      `/calendars/${encId}/events?${params.toString()}`
    );
    all.push(...(data?.items || []));
    pageToken = data?.nextPageToken || '';
  } while (pageToken);

  return all;
}

/**
 * Fetch events for one account across ALL calendars in the month window.
 * Returns { events, meta } for UI diagnostics.
 */
export async function fetchEventsForAccount(state, account) {
  const accessToken = getValidToken(state, account.id);
  const { timeMin, timeMax } = monthWindow(state.viewYear, state.viewMonth);

  const calendars = await listCalendars(accessToken);
  console.info(
    `[calendar] ${account.email}: ${calendars.length} calendars, window ${timeMin} → ${timeMax}`
  );

  const events = [];
  const perCal = [];

  // Parallel per calendar (cap concurrency lightly by batching)
  const results = await Promise.allSettled(
    calendars.map(async (cal) => {
      const items = await listEventsForCalendar(accessToken, cal.id, timeMin, timeMax);
      return { cal, items };
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled') {
      const { cal, items } = r.value;
      perCal.push({ id: cal.id, summary: cal.summary, count: items.length });
      for (const item of items) {
        events.push(normalizeEvent(item, account, cal));
      }
    } else {
      console.warn(`[calendar] ${account.email} calendar fetch failed`, r.reason);
      perCal.push({ id: '?', summary: 'error', count: -1, error: String(r.reason?.message || r.reason) });
    }
  }

  console.info(`[calendar] ${account.email}: total events ${events.length}`, perCal);

  return {
    events,
    meta: {
      email: account.email,
      calendars: calendars.length,
      total: events.length,
      perCal,
      timeMin,
      timeMax,
    },
  };
}

export async function insertEvent(state, accountId, resource, calendarId = 'primary') {
  const accessToken = getValidToken(state, accountId);
  const encId = encodeURIComponent(calendarId || 'primary');
  return calendarRequest(accessToken, `/calendars/${encId}/events`, {
    method: 'POST',
    body: resource,
  });
}

export async function deleteEvent(state, accountId, eventId, calendarId = 'primary') {
  const accessToken = getValidToken(state, accountId);
  const encCal = encodeURIComponent(calendarId || 'primary');
  const encEv = encodeURIComponent(eventId);
  return calendarRequest(accessToken, `/calendars/${encCal}/events/${encEv}`, {
    method: 'DELETE',
  });
}

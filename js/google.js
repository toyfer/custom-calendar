/** Google Identity + Calendar API access (REST; multi-calendar) */

import { DISCOVERY_DOC, SCOPES, WRITABLE_ROLES } from './constants.js';
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
    const d = new Date(`${end}T00:00:00`);
    d.setDate(d.getDate() - 1);
    end = toYmd(d);
  }
  const recurringEventId = item.recurringEventId || '';
  const isRecurring = !!(recurringEventId || item.recurrence);
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
    location: item.location || '',
    start,
    end,
    allDay,
    htmlLink: item.htmlLink || '',
    recurringEventId,
    isRecurring,
    // originalStartTime for recurring instance patch
    originalStartTime: item.originalStartTime || null,
  };
}

export async function initGapiClient(state) {
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

export async function trySilentRefresh(state, accountId) {
  const acc = accountById(state, accountId);
  if (!acc || !state.tokenClient) return false;
  try {
    const resp = await requestAccessToken(state, {
      prompt: '',
      hint: acc.email,
    });
    if (!resp?.access_token) return false;
    state.tokens[accountId] = {
      accessToken: resp.access_token,
      expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000,
      scope: resp.scope || state.tokens[accountId]?.scope || '',
    };
    acc.stale = false;
    persistAccounts(state);
    return true;
  } catch {
    acc.stale = true;
    persistAccounts(state);
    return false;
  }
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

  if (resp.scope) console.info('[calendar] granted scopes:', resp.scope);

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
  delete state.calendarsByAccount[accountId];
  state.events = state.events.filter((e) => e.accountId !== accountId);
  if (state.createAccountId === accountId) {
    state.createAccountId = liveAccounts(state)[0]?.id || state.accounts[0]?.id || null;
    state.createCalendarId = 'primary';
  }
  persistAccounts(state);
}

async function getValidToken(state, accountId) {
  const tok = state.tokens[accountId];
  if (!tok?.accessToken) {
    const ok = await trySilentRefresh(state, accountId);
    if (!ok) throw new Error('token missing');
    return state.tokens[accountId].accessToken;
  }
  if (tok.expiresAt && tok.expiresAt < Date.now() + 120_000) {
    const ok = await trySilentRefresh(state, accountId);
    if (ok) return state.tokens[accountId].accessToken;
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

export function monthWindow(viewYear, viewMonth) {
  const start = new Date(viewYear, viewMonth, 1, 0, 0, 0, 0);
  const end = new Date(viewYear, viewMonth + 1, 0, 23, 59, 59, 999);
  start.setDate(start.getDate() - 1);
  end.setDate(end.getDate() + 1);
  return {
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
  };
}

/** Wider window for week/list — pad ±7 days around selected date's month */
export function rangeWindow(timeMinDate, timeMaxDate) {
  return {
    timeMin: timeMinDate.toISOString(),
    timeMax: timeMaxDate.toISOString(),
  };
}

async function listCalendars(accessToken) {
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
          accessRole: c.accessRole,
          writable: WRITABLE_ROLES.has(c.accessRole),
        }));
    }
  } catch (err) {
    console.warn('[calendar] calendarList failed, using primary only', err);
  }
  return [{ id: 'primary', summary: 'primary', primary: true, accessRole: 'owner', writable: true }];
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

export async function fetchEventsForAccount(state, account, windowOverride = null) {
  const accessToken = await getValidToken(state, account.id);
  const { timeMin, timeMax } =
    windowOverride || monthWindow(state.viewYear, state.viewMonth);

  const calendars = await listCalendars(accessToken);
  // Cache calendar list for create form
  state.calendarsByAccount[account.id] = calendars;

  console.info(
    `[calendar] ${account.email}: ${calendars.length} calendars, window ${timeMin} → ${timeMax}`
  );

  const events = [];
  const perCal = [];

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
      perCal.push({
        id: '?',
        summary: 'error',
        count: -1,
        error: String(r.reason?.message || r.reason),
      });
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
  const accessToken = await getValidToken(state, accountId);
  const encId = encodeURIComponent(calendarId || 'primary');
  return calendarRequest(accessToken, `/calendars/${encId}/events`, {
    method: 'POST',
    body: resource,
  });
}

/**
 * Patch event. For recurring:
 *  - scope 'single': patch this instance id
 *  - scope 'all': patch recurringEventId (master)
 */
export async function patchEvent(
  state,
  accountId,
  eventId,
  resource,
  calendarId = 'primary',
  { scope = 'single', recurringEventId = '' } = {}
) {
  const accessToken = await getValidToken(state, accountId);
  const targetId =
    scope === 'all' && recurringEventId ? recurringEventId : eventId;
  const encCal = encodeURIComponent(calendarId || 'primary');
  const encEv = encodeURIComponent(targetId);
  return calendarRequest(accessToken, `/calendars/${encCal}/events/${encEv}`, {
    method: 'PATCH',
    body: resource,
  });
}

export async function deleteEvent(
  state,
  accountId,
  eventId,
  calendarId = 'primary',
  { scope = 'single', recurringEventId = '' } = {}
) {
  const accessToken = await getValidToken(state, accountId);
  const targetId =
    scope === 'all' && recurringEventId ? recurringEventId : eventId;
  const encCal = encodeURIComponent(calendarId || 'primary');
  const encEv = encodeURIComponent(targetId);
  return calendarRequest(accessToken, `/calendars/${encCal}/events/${encEv}`, {
    method: 'DELETE',
  });
}

/** Build Google event resource from form fields */
export function buildEventResource({
  summary,
  description,
  location,
  allDay,
  startLocal,
  endLocal,
  rrule,
  timeZone,
}) {
  const resource = {
    summary,
    description: description || undefined,
    location: location || undefined,
  };

  if (allDay) {
    const s = startLocal.slice(0, 10);
    let eDate = endLocal.slice(0, 10);
    // exclusive end
    const [y, m, d] = eDate.split('-').map(Number);
    const ed = new Date(y, m - 1, d);
    ed.setDate(ed.getDate() + 1);
    eDate = `${ed.getFullYear()}-${String(ed.getMonth() + 1).padStart(2, '0')}-${String(ed.getDate()).padStart(2, '0')}`;
    resource.start = { date: s };
    resource.end = { date: eDate };
  } else {
    const start = new Date(startLocal);
    const end = new Date(endLocal);
    resource.start = { dateTime: start.toISOString(), timeZone };
    resource.end = { dateTime: end.toISOString(), timeZone };
  }

  if (rrule) {
    resource.recurrence = [`RRULE:${rrule}`];
  }

  return resource;
}

/** Resource for time-only move (drag) */
export function buildTimePatch(ev, { start, end, allDay }, timeZone) {
  if (allDay) {
    const s = start.slice(0, 10);
    let e = (end || start).slice(0, 10);
    const [y, m, d] = e.split('-').map(Number);
    const ed = new Date(y, m - 1, d);
    ed.setDate(ed.getDate() + 1);
    e = `${ed.getFullYear()}-${String(ed.getMonth() + 1).padStart(2, '0')}-${String(ed.getDate()).padStart(2, '0')}`;
    return {
      start: { date: s },
      end: { date: e },
    };
  }
  return {
    start: { dateTime: new Date(start).toISOString(), timeZone },
    end: { dateTime: new Date(end).toISOString(), timeZone },
  };
}

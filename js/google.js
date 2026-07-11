/** Google Identity + Calendar API access (REST; no gapi.calendar dependency) */

import { DISCOVERY_DOC, SCOPES } from './constants.js';
import {
  accountById,
  hasValidConfig,
  liveAccounts,
  nextColor,
  persistAccounts,
} from './state.js';
import { startOfMonth, toYmd } from './dates.js';

const CAL_BASE = 'https://www.googleapis.com/calendar/v3';

export function normalizeEvent(item, account) {
  const allDay = !!item.start?.date && !item.start?.dateTime;
  const start = item.start?.dateTime || item.start?.date;
  let end = item.end?.dateTime || item.end?.date;
  if (allDay && end) {
    const d = new Date(`${end}T00:00:00`);
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

/**
 * Optional: keep gapi client init for compatibility.
 * Calendar CRUD uses REST below so discovery load failures don't break the app.
 */
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
    // Non-fatal: we use REST for Calendar
    console.warn('[calendar] gapi.client.init failed (using REST fallback)', err);
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

/**
 * Add or refresh an account. Always opens account picker for multi-account.
 * @param {'add'|'reauth'} mode
 */
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

  state.tokens[id] = { accessToken, expiresAt };

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

/**
 * Calendar API via REST + Bearer token.
 * Safer for multi-account than gapi.client (single global token + discovery race).
 */
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

export async function fetchEventsForAccount(state, account) {
  const accessToken = getValidToken(state, account.id);
  const timeMin = startOfMonth(state.viewYear, state.viewMonth).toISOString();
  const timeMax = new Date(state.viewYear, state.viewMonth + 1, 7, 23, 59, 59).toISOString();

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    showDeleted: 'false',
    singleEvents: 'true',
    maxResults: '2500',
    orderBy: 'startTime',
  });

  const data = await calendarRequest(
    accessToken,
    `/calendars/primary/events?${params.toString()}`
  );
  return (data?.items || []).map((item) => normalizeEvent(item, account));
}

export async function insertEvent(state, accountId, resource) {
  const accessToken = getValidToken(state, accountId);
  return calendarRequest(accessToken, '/calendars/primary/events', {
    method: 'POST',
    body: resource,
  });
}

export async function deleteEvent(state, accountId, eventId) {
  const accessToken = getValidToken(state, accountId);
  const id = encodeURIComponent(eventId);
  return calendarRequest(accessToken, `/calendars/primary/events/${id}`, {
    method: 'DELETE',
  });
}

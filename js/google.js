/** Google Identity + Calendar API access */

import { DISCOVERY_DOC, SCOPES } from './constants.js';
import {
  accountById,
  hasValidConfig,
  liveAccounts,
  nextColor,
  persistAccounts,
} from './state.js';
import { endOfMonth, startOfMonth, toYmd } from './dates.js';

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

export async function initGapiClient(state) {
  await gapi.client.init({
    apiKey: state.apiKey,
    discoveryDocs: [DISCOVERY_DOC],
  });
  state.gapiReady = true;
}

export function initTokenClient(state, callback = () => {}) {
  state.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: state.clientId,
    scope: SCOPES,
    callback,
  });
}

export function applyToken(accessToken) {
  gapi.client.setToken({ access_token: accessToken });
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

  // Prefer create target = newly connected if none or previous missing
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

export async function withAccountToken(state, accountId, fn) {
  const tok = state.tokens[accountId];
  if (!tok?.accessToken) throw new Error('token missing');
  if (tok.expiresAt && tok.expiresAt < Date.now() + 15_000) {
    const acc = accountById(state, accountId);
    if (acc) acc.stale = true;
    persistAccounts(state);
    throw new Error('token expired');
  }
  applyToken(tok.accessToken);
  return fn();
}

export async function fetchEventsForAccount(state, account) {
  return withAccountToken(state, account.id, async () => {
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

export async function insertEvent(state, accountId, resource) {
  return withAccountToken(state, accountId, async () => {
    await gapi.client.calendar.events.insert({
      calendarId: 'primary',
      resource,
    });
  });
}

export async function deleteEvent(state, accountId, eventId) {
  return withAccountToken(state, accountId, async () => {
    await gapi.client.calendar.events.delete({
      calendarId: 'primary',
      eventId,
    });
  });
}

// silence unused import warning in some tooling
void endOfMonth;

/** Shared constants */

export const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest';

// calendar.events alone cannot always list calendarList → secondary calendars missed
export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

export const STORAGE = {
  config: 'custom-calendar.oauth',
  accounts: 'custom-calendar.accounts.v3',
  tokens: 'custom-calendar.tokens.v3',
  ui: 'custom-calendar.ui.v3',
};

export const DB = {
  name: 'custom-calendar-db',
  version: 3,
  store: 'events',
};

export const DOW = ['日', '月', '火', '水', '木', '金', '土'];

export const PALETTE = [
  '#7b93ff',
  '#3dd68c',
  '#ffb86b',
  '#ff6b9d',
  '#c4a7ff',
  '#5eead4',
  '#f0abfc',
  '#67e8f9',
];
